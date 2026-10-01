using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using Gymli.Checkin.Core;
using Gymli.Checkin.Core.Engine;
using Gymli.Checkin.Core.Security;
using Gymli.Checkin.Core.Storage;
using Gymli.Checkin.Core.Sync;
using Gymli.Checkin.Hardware.Simulated;
using Xunit;

namespace Gymli.Checkin.Tests;

/// <summary>
/// Talks to the Firebase emulator seeded by `npm run seed` (apps/web). Skipped when the
/// emulator is not running. Proves sync, door-log upload and enrolment pass firestore.rules.
/// </summary>
public sealed class SyncEmulatorTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "gymli-sync-" + Guid.NewGuid().ToString("N"));
    private readonly CheckinSettings _settings = new()
    {
        Mode = "simulation",
        FirebaseApiKey = "demo-key",
        FirebaseProjectId = "demo-gymli",
        EmulatorHost = "127.0.0.1",
        DeviceEmail = "turnstile1@gymli.local",
        DevicePassword = "gymli-demo-2026",
        RelayPulseMs = 1,
    };

    private static bool EmulatorUp()
    {
        try { using var c = new TcpClient(); c.Connect("127.0.0.1", 8080); return true; } catch { return false; }
    }

    [SkippableFact]
    public async Task PullsMembers_UploadsDoorLogs_AndEnrols()
    {
        Skip.IfNot(EmulatorUp(), "Firebase emulator not running");
        using var fs = new FirestoreClient(_settings);
        using var store = new LocalStore(Path.Combine(_dir, "g.db"), new TemplateProtector(RandomNumberGenerator.GetBytes(32)));
        var sync = new SyncService(fs, store, _settings, () => (true, true));

        await sync.SyncOnceAsync(default);
        Assert.True(store.MemberCount >= 30, $"members: {store.MemberCount}");
        var thabo = store.Members.Single(m => m.Number == 1007);
        Assert.True(thabo.FingerprintEnrolled);

        // Scan → queued → uploaded
        var reader = new SimulatedReader();
        var relay = new SimulatedRelay();
        var engine = new CheckinEngine(reader, relay, store, new SystemClock(() => 0), _settings, () => true) { Sync = sync };
        var o = await engine.ProcessAsync(new(Encoding.UTF8.GetBytes("SIM:" + thabo.Id)), default);
        Assert.Equal(1, store.PendingCount);
        await sync.PushDoorLogsAsync(default);
        Assert.Equal(0, store.PendingCount);

        // Uploading the same log again is harmless
        store.Enqueue(o.Log);
        await sync.PushDoorLogsAsync(default);
        Assert.Equal(0, store.PendingCount);

        // Enrolment as the check-in PC passes the rules (template + member flag + audit, one commit)
        var ntombi = store.Members.Single(m => m.Number == 1030);
        var cipher = store.Encrypt(Encoding.UTF8.GetBytes("SIM:" + ntombi.Id));
        await sync.SaveEnrolmentAsync(ntombi.Id, 1030, cipher, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), "right_index", default);
        await sync.PullMembersAsync(default);
        Assert.True(store.GetMember(ntombi.Id)!.FingerprintEnrolled);
        Assert.True(store.HasTemplate(ntombi.Id));

        await sync.HeartbeatAsync(default);
    }

    [SkippableFact]
    public async Task WrongPassword_IsReported()
    {
        Skip.IfNot(EmulatorUp(), "Firebase emulator not running");
        var bad = new CheckinSettings { FirebaseApiKey = "demo-key", FirebaseProjectId = "demo-gymli", EmulatorHost = "127.0.0.1", DeviceEmail = "turnstile1@gymli.local", DevicePassword = "nope" };
        using var fs = new FirestoreClient(bad);
        var ex = await Assert.ThrowsAsync<SyncException>(() => fs.GetAsync("config/bootstrap", default));
        Assert.True(ex.AuthFailed);
    }

    public void Dispose() { try { Directory.Delete(_dir, true); } catch { } }
}
