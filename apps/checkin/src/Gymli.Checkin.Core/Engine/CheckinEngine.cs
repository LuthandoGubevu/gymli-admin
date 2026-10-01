using System.Text;
using Gymli.Checkin.Core.Access;
using Gymli.Checkin.Core.Hardware;
using Gymli.Checkin.Core.Storage;
using Gymli.Checkin.Core.Sync;

namespace Gymli.Checkin.Core.Engine;

public enum KioskState { Idle, Result, Enrolling }

/// <summary>Progress of an enrolment, shown on the kiosk and mirrored to the web modal.</summary>
public sealed record EnrolProgress(string MemberName, int Step, int Total, string Message, bool Done, bool Failed);

/// <summary>
/// The turnstile loop: wait for a finger → identify (1:N, local) → decide (local rules)
/// → pulse the relay only when allowed → queue the door log. Works fully offline.
/// </summary>
public sealed class CheckinEngine
{
    public const int EnrolScans = 4;

    private readonly IFingerprintReader _reader;
    private readonly ITurnstileRelay _relay;
    private readonly LocalStore _store;
    private readonly IClock _clock;
    private readonly CheckinSettings _settings;
    private readonly Func<bool> _online;
    private readonly SemaphoreSlim _readerGate = new(1, 1);
    private CancellationTokenSource? _identifyCts;
    private readonly object _enrolGate = new();
    private EnrolRequest? _pendingEnrol;

    public SyncService? Sync { get; set; }

    public event Action<ScanOutcome>? ScanCompleted;
    public event Action<EnrolProgress?>? EnrolChanged;
    public event Action<string>? RelayPulsed;

    public CheckinEngine(IFingerprintReader reader, ITurnstileRelay relay, LocalStore store, IClock clock, CheckinSettings settings, Func<bool> online)
    {
        _reader = reader;
        _relay = relay;
        _store = store;
        _clock = clock;
        _settings = settings;
        _online = online;
    }

    /* ---------------- Main loop ---------------- */

    public async Task RunAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            EnrolRequest? enrol;
            lock (_enrolGate)
            {
                enrol = _pendingEnrol;
                _pendingEnrol = null;
            }
            if (enrol is not null)
            {
                await EnrolAsync(enrol, ct);
                continue;
            }

            if (!_reader.IsConnected)
            {
                await Task.Delay(500, ct).ContinueWith(_ => { });
                continue;
            }

            FingerSample sample;
            _identifyCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            await _readerGate.WaitAsync(ct);
            try
            {
                sample = await _reader.CaptureAsync(_identifyCts.Token);
            }
            catch (OperationCanceledException)
            {
                continue; // an enrolment took over the reader, or we are shutting down
            }
            catch (Exception ex)
            {
                Log.Warn($"Capture failed: {ex.Message}");
                await Task.Delay(1000, ct).ContinueWith(_ => { });
                continue;
            }
            finally
            {
                _readerGate.Release();
            }

            var outcome = await ProcessAsync(sample, ct);
            ScanCompleted?.Invoke(outcome);
            // Result stays on screen; scans during this time are ignored (one person, one entry).
            await Task.Delay(TimeSpan.FromSeconds(_settings.ResultSeconds), ct).ContinueWith(_ => { });
        }
    }

    /// <summary>Decides one scan. Public for tests.</summary>
    public async Task<ScanOutcome> ProcessAsync(FingerSample sample, CancellationToken ct)
    {
        var now = _clock.Now;
        var today = _clock.Today;
        var candidates = Candidates();
        string? memberId = null;
        try
        {
            memberId = _reader.Identify(sample, candidates);
        }
        catch (Exception ex)
        {
            Log.Error("Identify failed", ex);
        }
        var member = memberId is null ? null : _store.GetMember(memberId);

        ScanOutcome outcome;
        if (member is null)
        {
            outcome = new ScanOutcome(false, null, AccessRules.DeniedText(DeniedReason.NotRecognised, null, today), "Please see reception",
                MakeLog(null, false, "not_recognised", "Fingerprint not recognised", null, now, today));
        }
        else
        {
            var d = AccessRules.Evaluate(member.Periods, today);
            if (d.Allowed)
            {
                var until = d.PaidUntil!.Value;
                var left = d.DaysLeft == 0 ? "last day today" : d.DaysLeft == 1 ? "1 day left" : $"{d.DaysLeft} days left";
                outcome = new ScanOutcome(true, member, member.Name, $"Paid until {AccessRules.FormatSmart(until, today)} · {left}",
                    MakeLog(member, true, null, "Welcome", until.ToString("yyyy-MM-dd"), now, today));
            }
            else
            {
                var text = AccessRules.DeniedText(d.Reason!.Value, d.Date, today);
                outcome = new ScanOutcome(false, member, text, $"{member.Name} · Please see reception",
                    MakeLog(member, false, AccessRules.ReasonCode(d.Reason!.Value), text, null, now, today));
            }
        }

        // Unlock first, then record: the member should never wait on the log.
        if (outcome.Allowed)
        {
            try
            {
                await _relay.PulseAsync(_settings.RelayPulseMs, ct);
                RelayPulsed?.Invoke($"{now.ToLocalTime():HH:mm:ss} relay pulse {_settings.RelayPulseMs} ms → {member!.Name}");
            }
            catch (Exception ex)
            {
                Log.Error("Relay pulse failed", ex);
            }
        }
        _store.Enqueue(outcome.Log);
        Log.Info($"Scan: {(outcome.Allowed ? "let in" : "denied")} {member?.Code ?? "unknown"} {(outcome.Allowed ? "" : outcome.Log.Text)}");
        return outcome;
    }

    private DoorLogEntry MakeLog(LocalMember? m, bool allowed, string? reason, string text, string? paidUntil, DateTimeOffset now, DateOnly today) =>
        new(Guid.NewGuid().ToString(), m?.Id, m?.Name, m?.Number, allowed, reason, text, paidUntil, now.ToUnixTimeMilliseconds(), today.ToString("yyyy-MM-dd"), !_online());

    private IReadOnlyList<StoredTemplate> Candidates()
    {
        var list = _store.Templates;
        if (!_settings.Simulation) return list;
        // Simulation: members enrolled without a real template (seed data) can still be "scanned".
        var extra = _store.Members.Where(m => m.FingerprintEnrolled && !_store.HasTemplate(m.Id))
            .Select(m => new StoredTemplate(m.Id, Encoding.UTF8.GetBytes("SIM:" + m.Id)));
        return [.. list, .. extra];
    }

    /* ---------------- Enrolment (asked for from the web app) ---------------- */

    public void RequestEnrol(EnrolRequest req)
    {
        lock (_enrolGate) _pendingEnrol = req;
        _identifyCts?.Cancel();
    }

    private async Task EnrolAsync(EnrolRequest req, CancellationToken ct)
    {
        if (Sync is null) return;
        var member = _store.GetMember(req.MemberId);
        var name = member?.Name ?? req.MemberName;
        Log.Info($"Enrolment started for GY-{req.MemberNumber}");
        await _readerGate.WaitAsync(ct);
        var samples = new List<FingerSample>();
        try
        {
            if (!_reader.IsConnected)
            {
                await Sync.UpdateEnrolAsync(req.Id, "failed", 0, "Fingerprint reader not connected", ct);
                return;
            }
            await Sync.UpdateEnrolAsync(req.Id, "scanning", 0, "Place the finger flat on the scanner", ct);
            var captured = 0;
            var deadline = DateTimeOffset.UtcNow.AddMinutes(3);
            while (captured < EnrolScans)
            {
                if (DateTimeOffset.UtcNow > deadline)
                {
                    await Sync.UpdateEnrolAsync(req.Id, "failed", captured, "Took too long. Start again.", ct);
                    EnrolChanged?.Invoke(null);
                    return;
                }
                var latest = await Sync.GetEnrolAsync(req.Id, ct);
                if (latest is null || latest.Status == "cancelled")
                {
                    Log.Info("Enrolment cancelled");
                    EnrolChanged?.Invoke(null);
                    return;
                }
                if (latest.CaptureSeq <= captured)
                {
                    EnrolChanged?.Invoke(new EnrolProgress(name, captured, EnrolScans, "Press Capture scan at reception", false, false));
                    await Task.Delay(700, ct);
                    continue;
                }
                EnrolChanged?.Invoke(new EnrolProgress(name, captured, EnrolScans, captured == 0 ? "Place your finger flat on the scanner" : "Lift, then place the same finger again", false, false));
                using var captureCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                captureCts.CancelAfter(TimeSpan.FromSeconds(20));
                FingerSample s;
                try
                {
                    s = await CaptureForEnrolAsync(req.MemberId, captureCts.Token);
                }
                catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                {
                    await Sync.UpdateEnrolAsync(req.Id, "scanning", captured, "No finger seen. Press Capture scan and try again.", ct);
                    continue;
                }
                samples.Add(s);
                captured++;
                await Sync.UpdateEnrolAsync(req.Id, "scanning", captured, captured < EnrolScans ? "Lift, then place the same finger flat on the scanner" : "Saving", ct);
            }

            var template = _reader.CreateTemplate(samples);
            if (template is null)
            {
                await Sync.UpdateEnrolAsync(req.Id, "failed", 0, "The scans did not match. Start again.", ct);
                EnrolChanged?.Invoke(new EnrolProgress(name, 0, EnrolScans, "The scans did not match", false, true));
                return;
            }
            // Same finger already belongs to someone else?
            var other = _reader.Identify(new FingerSample(template), _store.Templates.Where(t => t.MemberId != req.MemberId).ToList());
            if (other is not null && !_settings.Simulation)
            {
                var o = _store.GetMember(other);
                await Sync.UpdateEnrolAsync(req.Id, "failed", 0, $"This finger is already enrolled for {o?.Code ?? "another member"}", ct);
                EnrolChanged?.Invoke(null);
                return;
            }

            var cipher = _store.Encrypt(template);
            var enrolledAt = _clock.Now.ToUnixTimeMilliseconds();
            await Sync.SaveEnrolmentAsync(req.MemberId, req.MemberNumber, cipher, enrolledAt, "right_index", ct);
            _store.SaveTemplate(req.MemberId, cipher, _store.KeyId, enrolledAt);
            await Sync.UpdateEnrolAsync(req.Id, "done", EnrolScans, "", ct);
            Log.Info($"Enrolment saved for GY-{req.MemberNumber}");
            EnrolChanged?.Invoke(new EnrolProgress(name, EnrolScans, EnrolScans, "Fingerprint enrolled", true, false));
            await Task.Delay(2500, ct).ContinueWith(_ => { });
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            Log.Error("Enrolment failed", ex);
            try { await Sync.UpdateEnrolAsync(req.Id, "failed", 0, "Something went wrong. Start again.", ct); } catch { /* offline */ }
        }
        finally
        {
            samples.Clear();
            _readerGate.Release();
            EnrolChanged?.Invoke(null);
        }
    }

    private Task<FingerSample> CaptureForEnrolAsync(string memberId, CancellationToken ct) =>
        _reader is IEnrolAware aware ? aware.CaptureForEnrolAsync(memberId, ct) : _reader.CaptureAsync(ct);
}

/// <summary>Simulated reader: during enrolment it "scans" the member being enrolled.</summary>
public interface IEnrolAware
{
    Task<FingerSample> CaptureForEnrolAsync(string memberId, CancellationToken ct);
}
