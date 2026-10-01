using System.Text;
using System.Threading.Channels;
using Gymli.Checkin.Core;
using Gymli.Checkin.Core.Engine;
using Gymli.Checkin.Core.Hardware;

namespace Gymli.Checkin.Hardware.Simulated;

/// <summary>
/// Stand-in for the DigitalPersona reader: the simulation panel "places a finger" by
/// choosing a member (or an unknown finger). Templates are "SIM:{memberId}".
/// </summary>
public sealed class SimulatedReader : IFingerprintReader, IEnrolAware
{
    private readonly Channel<string?> _fingers = Channel.CreateUnbounded<string?>();
    private bool _connected = true;

    public string Name => "Simulated reader";
    public bool IsConnected => _connected;
    public event EventHandler<bool>? ConnectionChanged;

    public Task StartAsync(CancellationToken ct) => Task.CompletedTask;

    /// <summary>Simulates a finger on the scanner. Null = a finger nobody enrolled.</summary>
    public void PresentFinger(string? memberId) => _fingers.Writer.TryWrite(memberId);

    /// <summary>Simulates unplugging / plugging in the reader.</summary>
    public void SetConnected(bool connected)
    {
        if (_connected == connected) return;
        _connected = connected;
        Log.Info(connected ? "Simulated reader plugged in" : "Simulated reader unplugged");
        ConnectionChanged?.Invoke(this, connected);
    }

    public async Task<FingerSample> CaptureAsync(CancellationToken ct)
    {
        var id = await _fingers.Reader.ReadAsync(ct);
        return new FingerSample(Encoding.UTF8.GetBytes("SIM:" + (id ?? "unknown-" + Guid.NewGuid())));
    }

    public async Task<FingerSample> CaptureForEnrolAsync(string memberId, CancellationToken ct)
    {
        await Task.Delay(600, ct); // feels like a real scan
        return new FingerSample(Encoding.UTF8.GetBytes("SIM:" + memberId));
    }

    public byte[]? CreateTemplate(IReadOnlyList<FingerSample> samples)
    {
        var first = Encoding.UTF8.GetString(samples[0].Fmd);
        return samples.All(s => Encoding.UTF8.GetString(s.Fmd) == first) ? samples[0].Fmd : null;
    }

    public string? Identify(FingerSample sample, IReadOnlyList<StoredTemplate> templates)
    {
        var probe = Encoding.UTF8.GetString(sample.Fmd);
        return templates.FirstOrDefault(t => Encoding.UTF8.GetString(t.Fmd) == probe)?.MemberId;
    }

    public void Dispose() => _fingers.Writer.TryComplete();
}

/// <summary>Logs pulses instead of switching a relay.</summary>
public sealed class SimulatedRelay : ITurnstileRelay
{
    public string Name => "Simulated relay";
    public bool IsConnected => true;
    public int Pulses { get; private set; }
    public event Action<int>? Pulsed;

    public Task PulseAsync(int milliseconds, CancellationToken ct)
    {
        Pulses++;
        Log.Info($"SIMULATED RELAY PULSE {milliseconds} ms");
        Pulsed?.Invoke(milliseconds);
        return Task.CompletedTask;
    }

    public void Dispose() { }
}
