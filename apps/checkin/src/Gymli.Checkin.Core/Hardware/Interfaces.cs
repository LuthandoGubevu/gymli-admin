namespace Gymli.Checkin.Core.Hardware;

/// <summary>
/// A finger presented to the reader, already reduced to a feature set (FMD).
/// Raw fingerprint images are never kept or sent anywhere (POPIA).
/// </summary>
public sealed record FingerSample(byte[] Fmd);

/// <summary>Fingerprint reader: DigitalPersona 4500 in production, a simulator on a desk.</summary>
public interface IFingerprintReader : IDisposable
{
    string Name { get; }
    bool IsConnected { get; }
    event EventHandler<bool>? ConnectionChanged;

    /// <summary>Starts the reader and keeps it connected (replug recovery).</summary>
    Task StartAsync(CancellationToken ct);

    /// <summary>Waits until a finger is placed and returns its feature set.</summary>
    Task<FingerSample> CaptureAsync(CancellationToken ct);

    /// <summary>Builds one enrolment template from several scans of the same finger. Null when they do not match.</summary>
    byte[]? CreateTemplate(IReadOnlyList<FingerSample> samples);

    /// <summary>1:N identification. Returns the matching member id, or null.</summary>
    string? Identify(FingerSample sample, IReadOnlyList<StoredTemplate> templates);
}

/// <summary>USB relay wired to the turnstile's entry input.</summary>
public interface ITurnstileRelay : IDisposable
{
    string Name { get; }
    bool IsConnected { get; }

    /// <summary>Closes the relay for <paramref name="milliseconds"/>, unlocking the arm for one entry.</summary>
    Task PulseAsync(int milliseconds, CancellationToken ct);
}
