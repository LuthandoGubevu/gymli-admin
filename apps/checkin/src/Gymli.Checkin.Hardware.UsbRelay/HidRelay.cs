using Gymli.Checkin.Core;
using Gymli.Checkin.Core.Hardware;
using HidSharp;

namespace Gymli.Checkin.Hardware.UsbRelay;

/// <summary>
/// HID USB relay boards ("USBRelay1/2/4/8", the common dcttech design, VID 16C0 / PID 05DF).
/// No driver needed: Windows sees them as a HID device. Protocol: feature report
/// [0x00, 0xFF = on / 0xFD = off, channel, 0, 0, 0, 0, 0, 0].
/// The relay's NO/COM contacts go to the turnstile controller's "entry" (dry contact) input.
/// </summary>
public sealed class HidRelay : ITurnstileRelay
{
    public const int VendorId = 0x16C0;
    public const int ProductId = 0x05DF;

    private readonly byte _channel;
    private readonly string? _path;
    private HidStream? _stream;
    private string _name = "USB relay (HID)";
    private DateTime _lastTry = DateTime.MinValue;
    private readonly SemaphoreSlim _gate = new(1, 1);

    /// <param name="path">A specific device (from <see cref="Find"/>); null = the first HID relay found.</param>
    public HidRelay(int channel, string? path = null)
    {
        _channel = (byte)Math.Clamp(channel, 1, 8);
        _path = path;
    }

    public string Name => _name;
    private readonly object _openLock = new();
    // Checked from the UI (tray), the heartbeat and the relay watcher at once: only one may open the device.
    public bool IsConnected { get { lock (_openLock) return StillThere() || TryOpen(force: false); } }
    private string? _openPath;

    /// <summary>True while the board is open AND still plugged in; a vanished board is closed so it can be reopened.</summary>
    private bool StillThere()
    {
        if (_stream is null) return false;
        try { if (Find().Any(d => d.DevicePath == _openPath)) return true; } catch { return true; /* cannot tell: keep it */ }
        Log.Warn("HID relay unplugged");
        Close();
        return false;
    }

    /// <summary>HID relay boards plugged in right now.</summary>
    public static IReadOnlyList<HidDevice> Find() =>
        DeviceList.Local.GetHidDevices(VendorId, ProductId)
            .Where(d => SafeName(d).StartsWith("USBRelay", StringComparison.OrdinalIgnoreCase) || SafeName(d) == "")
            .ToList();

    internal static string SafeName(HidDevice d)
    {
        try { return d.GetProductName() ?? ""; } catch { return ""; }
    }

    /// <summary>The 9-byte feature report that switches one channel on or off.</summary>
    public static byte[] Frame(byte channel, bool on) => [0x00, on ? (byte)0xFF : (byte)0xFD, channel, 0, 0, 0, 0, 0, 0];

    /// <param name="force">A pulse is waiting: try now, even if the last try was moments ago.</param>
    private bool TryOpen(bool force)
    {
        // Background checks retry at most every 5 seconds (relay unplugged, or not yet plugged in)
        if (!force && DateTime.UtcNow - _lastTry < TimeSpan.FromSeconds(5)) return false;
        _lastTry = DateTime.UtcNow;
        try
        {
            var device = _path is null ? Find().FirstOrDefault() : Find().FirstOrDefault(d => d.DevicePath == _path);
            if (device is null || !device.TryOpen(out var stream)) return false;
            _stream = stream;
            _openPath = device.DevicePath;
            _name = $"USB relay ({SafeName(device)}, HID)";
            Write(false); // make sure the arm starts locked
            Log.Info($"Relay connected: {_name}");
            return true;
        }
        catch (Exception ex)
        {
            Close();
            Log.Warn($"HID relay not available: {ex.Message}");
            return false;
        }
    }

    private void Write(bool on) => _stream!.SetFeature(Frame(_channel, on));

    public async Task PulseAsync(int milliseconds, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            bool ready;
            lock (_openLock) ready = StillThere() || TryOpen(force: true);
            if (!ready) throw new IOException("Relay not connected");
            try
            {
                Write(true);
                // Non-blocking wait: no thread is held while the contact is closed.
                await Task.Delay(milliseconds, CancellationToken.None);
            }
            finally
            {
                // Always switch off again, even if the wait failed — never leave the arm unlocked.
                try { Write(false); } catch (Exception ex) { Log.Error("Relay did not switch off", ex); lock (_openLock) Close(); }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            lock (_openLock) Close(); // unplugged: the next check opens it again
            throw;
        }
        finally
        {
            _gate.Release();
        }
    }

    private void Close()
    {
        try { _stream?.Dispose(); } catch { }
        _stream = null;
        _openPath = null;
    }

    public void Dispose()
    {
        try { if (_stream is not null) Write(false); } catch { }
        Close();
    }
}
