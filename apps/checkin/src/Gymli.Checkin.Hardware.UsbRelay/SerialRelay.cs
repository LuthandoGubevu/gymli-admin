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
    public bool IsConnected => _port?.IsOpen == true || TryOpen();

    private bool TryOpen()
    {
        // Retry at most every 5 seconds (relay unplugged, or not yet plugged in)
        if (DateTime.UtcNow - _lastTry < TimeSpan.FromSeconds(5)) return false;
        _lastTry = DateTime.UtcNow;
        try
        {
            var name = string.IsNullOrWhiteSpace(_configuredPort) ? SerialPort.GetPortNames().OrderBy(p => p).LastOrDefault() : _configuredPort;
            if (name is null) return false;
            _port?.Dispose();
            _port = new SerialPort(name, 9600, Parity.None, 8, StopBits.One) { WriteTimeout = 500, ReadTimeout = 500 };
            _port.Open();
            Write(false); // make sure the arm starts locked
            Log.Info($"Relay connected on {name}");
            return true;
        }
        catch (Exception ex)
        {
            _port?.Dispose();
            _port = null;
            Log.Warn($"Relay not available: {ex.Message}");
            return false;
        }
    }

    private void Write(bool on)
    {
        var state = (byte)(on ? 1 : 0);
        var frame = new byte[] { 0xA0, _channel, state, (byte)(0xA0 + _channel + state) };
        _port!.Write(frame, 0, frame.Length);
    }

    public async Task PulseAsync(int milliseconds, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            if (!IsConnected) throw new IOException("Relay not connected");
            try
            {
                Write(true);
                await Task.Delay(milliseconds, CancellationToken.None);
            }
            finally
            {
                // Always switch off again, even if the wait failed — never leave the arm unlocked.
                try { Write(false); } catch (Exception ex) { Log.Error("Relay did not switch off", ex); _port?.Dispose(); _port = null; }
            }
        }
        catch (Exception) when (_port is { IsOpen: false })
        {
            _port = null;
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
        _port?.Dispose();
    }
}
