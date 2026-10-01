using System.Security.Cryptography;
using System.Text;
using Gymli.Checkin.Core;
using Gymli.Checkin.Core.Access;
using Gymli.Checkin.Core.Engine;
using Gymli.Checkin.Core.Hardware;
using Gymli.Checkin.Core.Security;
using Gymli.Checkin.Core.Storage;
using Gymli.Checkin.Hardware.Simulated;
using Xunit;

namespace Gymli.Checkin.Tests;

public sealed class EngineTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "gymli-test-" + Guid.NewGuid().ToString("N"));
    private readonly LocalStore _store;
    private readonly SimulatedReader _reader = new();
    private readonly SimulatedRelay _relay = new();
    private readonly FixedClock _clock = new(new DateTimeOffset(2026, 10, 1, 8, 0, 0, TimeSpan.FromHours(2)));
    private readonly CheckinEngine _engine;
    private bool _online = true;

    public EngineTests()
    {
        _store = new LocalStore(Path.Combine(_dir, "gymli.db"), new TemplateProtector(RandomNumberGenerator.GetBytes(32)));
        _engine = new CheckinEngine(_reader, _relay, _store, _clock, new CheckinSettings { Mode = "simulation", RelayPulseMs = 1 }, () => _online);
        _store.UpsertMembers([
            Member("thabo", 1007, "Thabo", "Nkosi", [new(D(2026, 9, 8), D(2026, 10, 7))]),
            Member("lerato", 1002, "Lerato", "Mokoena", [new(D(2026, 9, 1), D(2026, 9, 30))]),
            Member("ntombi", 1030, "Ntombi", "Cele", [], enrolled: false),
            Member("future", 1040, "Sizwe", "Ntuli", [new(D(2026, 10, 15), D(2026, 11, 14))]),
            Member("never", 1041, "Refilwe", "Moloi", []),
        ]);
        // Thabo has a real (simulated) template, encrypted at rest
        _store.SaveTemplate("thabo", _store.Encrypt(Encoding.UTF8.GetBytes("SIM:thabo")), _store.KeyId, 1);
    }

    private static DateOnly D(int y, int m, int d) => new(y, m, d);
    private static LocalMember Member(string id, int n, string f, string l, List<PeriodDates> p, bool enrolled = true) => new(id, n, f, l, p, enrolled, 1, false);
    private static FingerSample Finger(string id) => new(Encoding.UTF8.GetBytes("SIM:" + id));

    [Fact]
    public async Task PaidMember_IsLetIn_AndRelayPulsesOnce()
    {
        var o = await _engine.ProcessAsync(Finger("thabo"), default);
        Assert.True(o.Allowed);
        Assert.Equal("Thabo Nkosi", o.Headline);
        Assert.Equal("Paid until 7 Oct · 6 days left", o.Detail);
        Assert.Equal(1, _relay.Pulses);
        Assert.Single(_store.PendingLogs());
        Assert.Equal("2026-10-07", o.Log.PaidUntil);
    }

    [Fact]
    public async Task ClockPastEndDate_Denied_NoPulse()
    {
        _clock.Value = new DateTimeOffset(2026, 10, 8, 0, 0, 1, TimeSpan.FromHours(2));
        var o = await _engine.ProcessAsync(Finger("thabo"), default);
        Assert.False(o.Allowed);
        Assert.Equal("Membership ended 7 Oct", o.Headline);
        Assert.Equal(0, _relay.Pulses);
    }

    [Fact]
    public async Task LastSecondOfEndDate_StillAllowed()
    {
        _clock.Value = new DateTimeOffset(2026, 10, 7, 23, 59, 59, TimeSpan.FromHours(2));
        Assert.True((await _engine.ProcessAsync(Finger("thabo"), default)).Allowed);
    }

    [Fact]
    public async Task UnknownFinger_Denied()
    {
        var o = await _engine.ProcessAsync(Finger("nobody"), default);
        Assert.False(o.Allowed);
        Assert.Equal("Fingerprint not recognised", o.Headline);
        Assert.Equal("not_recognised", o.Log.Reason);
        Assert.Null(o.Log.MemberId);
        Assert.Equal(0, _relay.Pulses);
    }

    [Fact]
    public async Task LockedOut_And_Future_And_Never()
    {
        Assert.Equal("Membership ended 30 Sep", (await _engine.ProcessAsync(Finger("lerato"), default)).Headline);
        Assert.Equal("Paid period starts 15 Oct", (await _engine.ProcessAsync(Finger("future"), default)).Headline);
        Assert.Equal("No paid membership", (await _engine.ProcessAsync(Finger("never"), default)).Headline);
        Assert.Equal(0, _relay.Pulses);
    }

    [Fact]
    public async Task NotEnrolledMember_IsNotRecognised()
    {
        var o = await _engine.ProcessAsync(Finger("ntombi"), default);
        Assert.Equal("Fingerprint not recognised", o.Headline);
    }

    [Fact]
    public async Task NewPaymentArrivingBySync_LetsMemberInStraightAway()
    {
        Assert.False((await _engine.ProcessAsync(Finger("lerato"), default)).Allowed);
        _store.UpsertMembers([Member("lerato", 1002, "Lerato", "Mokoena", [new(D(2026, 9, 1), D(2026, 9, 30)), new(D(2026, 10, 1), D(2026, 12, 31))])]);
        Assert.True((await _engine.ProcessAsync(Finger("lerato"), default)).Allowed);
    }

    [Fact]
    public async Task Offline_ScansStillWork_AndAreQueuedAsOffline()
    {
        _online = false;
        var o = await _engine.ProcessAsync(Finger("thabo"), default);
        Assert.True(o.Allowed);
        Assert.True(_store.PendingLogs().Single().Offline);
    }

    [Fact]
    public void RemovedMember_TemplateErasedLocally()
    {
        Assert.True(_store.HasTemplate("thabo"));
        _store.UpsertMembers([new LocalMember("thabo", 1007, "", "", [], false, 0, true)]);
        Assert.False(_store.HasTemplate("thabo"));
        Assert.Null(_store.GetMember("thabo"));
    }

    [Fact]
    public void Templates_AreEncryptedOnDisk_AndSurviveRestart()
    {
        var key = RandomNumberGenerator.GetBytes(32);
        var path = Path.Combine(_dir, "restart.db");
        using (var s = new LocalStore(path, new TemplateProtector(key)))
        {
            s.UpsertMembers([Member("a", 1, "A", "B", [])]);
            s.SaveTemplate("a", s.Encrypt(Encoding.UTF8.GetBytes("SIM:a-secret")), s.KeyId, 5);
        }
        Assert.DoesNotContain("SIM:a-secret", Encoding.UTF8.GetString(File.ReadAllBytes(path)));
        using var again = new LocalStore(path, new TemplateProtector(key));
        Assert.Equal("SIM:a-secret", Encoding.UTF8.GetString(again.Templates.Single().Fmd));
        // A different key cannot read it
        using var wrong = new LocalStore(path, new TemplateProtector(RandomNumberGenerator.GetBytes(32)));
        Assert.Empty(wrong.Templates);
    }

    [Fact]
    public void DoorLogQueue_SurvivesRestart_AndClearsWhenUploaded()
    {
        var log = new DoorLogEntry("l1", "thabo", "Thabo Nkosi", 1007, true, null, "Welcome", "2026-10-07", 1, "2026-10-01", true);
        _store.Enqueue(log);
        _store.Enqueue(log); // same id twice: kept once
        Assert.Equal(1, _store.PendingCount);
        _store.MarkUploaded("l1");
        Assert.Equal(0, _store.PendingCount);
    }

    [Fact]
    public void Protector_RoundTrip_And_TamperDetected()
    {
        var p = new TemplateProtector(RandomNumberGenerator.GetBytes(32));
        var c = p.Encrypt([1, 2, 3]);
        Assert.Equal(new byte[] { 1, 2, 3 }, p.Decrypt(c));
        var bytes = Convert.FromBase64String(c);
        bytes[^1] ^= 0xFF;
        Assert.ThrowsAny<CryptographicException>(() => p.Decrypt(Convert.ToBase64String(bytes)));
    }

    public void Dispose()
    {
        _store.Dispose();
        try { Directory.Delete(_dir, true); } catch { }
    }
}
