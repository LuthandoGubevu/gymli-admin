using System.IO.Ports;
using Gymli.Checkin.Core;
using Gymli.Checkin.Core.Hardware;

namespace Gymli.Checkin.Hardware.UsbRelay;

/// <summary>
/// USB relay boards based on the CH340 serial chip (LCUS-1 and the 2/4/8-channel versions).
/// Protocol: A0 [channel] [state] [checksum]; checksum = A0 + channel + state.
/// The relay's NO/COM contacts go to the turnstile controller's "entry" (dry contact) input.
/// </summary>
public sealed class SerialRelay : ITurnstileRelay
{
    private readonly string _configuredPort;
    private readonly byte _channel;
    private SerialPort? _port;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public SerialRelay(string port, int channel)
    {
        _configuredPort = port;
        _channel = (byte)Math.Clamp(channel, 1, 8);
    }

    public string Name => $"USB relay {_port?.PortName ?? _configuredPort}";
    private DateTime _lastTry = DateTime.MinValue;
    private bool _warnedNoPort;
    private readonly object _openLock = new();
    // Checked from the UI (tray), the heartbeat and the relay watcher at once: only one may open the port.
    public bool IsConnected { get { lock (_openLock) return StillThere() || TryOpen(force: false); } }

    /// <summary>
    /// True while the port is open AND still plugged in. Windows can leave a pulled-out USB serial
    /// port "open", so the port list is checked too; a vanished port is closed so it can be reopened.
    /// </summary>
    private bool StillThere()
    {
        if (_port is null) return false;
        if (_port.IsOpen && SerialPort.GetPortNames().Contains(_port.PortName, StringComparer.OrdinalIgnoreCase)) return true;
        Log.Warn($"Relay on {_port.PortName} unplugged");
        Drop();
        return false;
    }

    private void Drop()
    {
        try { _port?.Dispose(); } catch { }
        _port = null;
    }

    /// <param name="force">A pulse is waiting: try now, even if the last try was moments ago.</param>
    private bool TryOpen(bool force)
    {
        // Background checks retry at most every 5 seconds (relay unplugged, or not yet plugged in)
        if (!force && DateTime.UtcNow - _lastTry < TimeSpan.FromSeconds(5)) return false;
        _lastTry = DateTime.UtcNow;
        try
        {
            // No port set: only a CH340 relay board is used (never a guess, e.g. a Bluetooth port).
            var name = string.IsNullOrWhiteSpace(_configuredPort) ? SerialPorts.List().FirstOrDefault(p => p.Ch340)?.Name : _configuredPort;
            if (name is null)
            {
                if (!_warnedNoPort) Log.Warn("No CH340 relay board found. Plug it in, or set RelayPort in appsettings.json.");
                _warnedNoPort = true;
                return false;
            }
            Drop();
            _warnedNoPort = false;
            _port = new SerialPort(name, 9600, Parity.None, 8, StopBits.One) { WriteTimeout = 500, ReadTimeout = 500 };
            _port.Open();
            Write(false); // make sure the arm starts locked
            Log.Info($"Relay connected on {name}");
            return true;
        }
        catch (Exception ex)
        {
            Drop();
            Log.Warn($"Relay not available: {ex.Message}");
            return false;
        }
    }

    /// <summary>The 4-byte LCUS command that switches one channel on or off.</summary>
    public static byte[] Frame(byte channel, bool on)
    {
        var state = (byte)(on ? 1 : 0);
        return [0xA0, channel, state, (byte)(0xA0 + channel + state)];
    }

    private void Write(bool on)
    {
        var frame = Frame(_channel, on);
        _port!.Write(frame, 0, frame.Length);
    }

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
                try { Write(false); } catch (Exception ex) { Log.Error("Relay did not switch off", ex); lock (_openLock) Drop(); }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Pulled out mid-pulse, or the port broke: drop it, the next check opens it again.
            lock (_openLock) Drop();
            throw;
        }
        finally
        {
            _gate.Release();
        }
    }

    public void Dispose()
    {
        try { if (_port?.IsOpen == true) Write(false); } catch { }
        Drop();
    }
}
