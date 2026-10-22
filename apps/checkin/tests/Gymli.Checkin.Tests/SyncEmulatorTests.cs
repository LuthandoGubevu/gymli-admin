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
        FirebaseDatabaseId = "(default)",
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
        Assert.Equal("sandton", sync.BranchId);
        Assert.True(store.MemberCount >= 30, $"members: {store.MemberCount}");
        Assert.DoesNotContain(store.Members, m => m.Number > 1030); // Soweto's members stay off this PC
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
        var ntombi = store.Members.Single(m => m.Number == 1029); // re-enrol Refilwe; keeps Ntombi (1030) un-enrolled for the visual check
        var cipher = store.Encrypt(Encoding.UTF8.GetBytes("SIM:" + ntombi.Id));
        await sync.SaveEnrolmentAsync(ntombi.Id, 1029, cipher, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), "right_index", default);
        await sync.PullMembersAsync(default);
        Assert.True(store.GetMember(ntombi.Id)!.FingerprintEnrolled);
        Assert.True(store.HasTemplate(ntombi.Id));

        await sync.HeartbeatAsync(default);
    }

    /// <summary>Writes straight to the emulator, bypassing the rules (test setup only).</summary>
    private static async Task AdminCommitAsync(System.Text.Json.Nodes.JsonArray writes)
    {
        using var http = new HttpClient();
        using var req = new HttpRequestMessage(HttpMethod.Post, "http://127.0.0.1:8080/v1/projects/demo-gymli/databases/(default)/documents:commit");
        req.Headers.Authorization = new("Bearer", "owner");
        req.Content = new StringContent(new System.Text.Json.Nodes.JsonObject { ["writes"] = writes }.ToJsonString(), Encoding.UTF8, "application/json");
        var res = await http.SendAsync(req);
        Assert.True(res.IsSuccessStatusCode, await res.Content.ReadAsStringAsync());
    }

    [SkippableFact]
    public async Task ManyMembersSavedAtOnce_AllArrive_AndHardDeletedOnesAreRemoved()
    {
        Skip.IfNot(EmulatorUp(), "Firebase emulator not running");
        const string docs = "projects/demo-gymli/databases/(default)/documents/members/";
        var ids = Enumerable.Range(0, 320).Select(i => $"bulk{i:000}").ToList();
        var stamp = DateTimeOffset.UtcNow.AddSeconds(5).UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ss.ffffffZ");
        System.Text.Json.Nodes.JsonObject Create(string id, int n) => new()
        {
            ["update"] = new System.Text.Json.Nodes.JsonObject
            {
                ["name"] = docs + id,
                ["fields"] = new System.Text.Json.Nodes.JsonObject
                {
                    ["branchId"] = Fs.Str("sandton"), ["number"] = Fs.Int(n), ["firstName"] = Fs.Str("Bulk"), ["lastName"] = Fs.Str(id),
                    ["cellphone"] = Fs.Str("0800000000"), ["periods"] = Fs.Array([]), ["fingerprint"] = Fs.Null(), ["deleted"] = Fs.Bool(false),
                    ["updatedAt"] = new System.Text.Json.Nodes.JsonObject { ["timestampValue"] = stamp },
                },
            },
        };
        System.Text.Json.Nodes.JsonObject Delete(string id) => new() { ["delete"] = docs + id };

        // 320 members with the SAME updatedAt (like an import or the first-branch setup)
        await AdminCommitAsync(new(ids.Select((id, i) => (System.Text.Json.Nodes.JsonNode)Create(id, i + 1)).ToArray()));
        try
        {
            using var fs = new FirestoreClient(_settings);
            using var store = new LocalStore(Path.Combine(_dir, "bulk.db"), new TemplateProtector(RandomNumberGenerator.GetBytes(32)));
            var sync = new SyncService(fs, store, _settings, () => (true, true));
            await sync.SyncOnceAsync(default);
            Assert.All(ids, id => Assert.NotNull(store.GetMember(id)));

            // Half of them hard-deleted in the cloud (a data reset): the PC drops them too
            await AdminCommitAsync(new(ids.Take(160).Select(id => (System.Text.Json.Nodes.JsonNode)Delete(id)).ToArray()));
            await sync.ReconcileMembersAsync(default, force: true);
            Assert.All(ids.Take(160), id => Assert.Null(store.GetMember(id)));
            Assert.All(ids.Skip(160), id => Assert.NotNull(store.GetMember(id)));
            Assert.Contains(store.Members, m => m.Number == 1007); // real members stay
        }
        finally
        {
            await AdminCommitAsync(new(ids.Select(id => (System.Text.Json.Nodes.JsonNode)Delete(id)).ToArray()));
        }
    }

    [SkippableFact]
    public async Task OtherBranch_OnlyGetsItsOwnMembers_AndTurnsAwayOthers()
    {
        Skip.IfNot(EmulatorUp(), "Firebase emulator not running");
        var soweto = new CheckinSettings
        {
            Mode = "simulation", FirebaseApiKey = "demo-key", FirebaseProjectId = "demo-gymli", FirebaseDatabaseId = "(default)",
            EmulatorHost = "127.0.0.1", DeviceEmail = "turnstile2@gymli.local", DevicePassword = "gymli-demo-2026", RelayPulseMs = 1,
        };
        using var fs = new FirestoreClient(soweto);
        using var store = new LocalStore(Path.Combine(_dir, "s.db"), new TemplateProtector(RandomNumberGenerator.GetBytes(32)));
        var sync = new SyncService(fs, store, soweto, () => (true, true));
        await sync.SyncOnceAsync(default);
        Assert.Equal("soweto", sync.BranchId);
        Assert.Equal(5, store.MemberCount);
        Assert.All(store.Members, m => Assert.True(m.Number > 1030));

        // A Sandton member's finger is not on this PC: turned away as not recognised
        var engine = new CheckinEngine(new SimulatedReader(), new SimulatedRelay(), store, new SystemClock(() => 0), soweto, () => true) { Sync = sync };
        var o = await engine.ProcessAsync(new(Encoding.UTF8.GetBytes("SIM:someone-from-sandton")), default);
        Assert.False(o.Log.Allowed);
        await sync.PushDoorLogsAsync(default);
        Assert.Equal(0, store.PendingCount);
        await sync.HeartbeatAsync(default);
    }

    [SkippableFact]
    public async Task WrongPassword_IsReported()
    {
        Skip.IfNot(EmulatorUp(), "Firebase emulator not running");
        var bad = new CheckinSettings { FirebaseApiKey = "demo-key", FirebaseProjectId = "demo-gymli", FirebaseDatabaseId = "(default)", EmulatorHost = "127.0.0.1", DeviceEmail = "turnstile1@gymli.local", DevicePassword = "nope" };
        using var fs = new FirestoreClient(bad);
        var ex = await Assert.ThrowsAsync<SyncException>(() => fs.GetAsync("config/bootstrap", default));
        Assert.True(ex.AuthFailed);
    }

    public void Dispose() { try { Directory.Delete(_dir, true); } catch { } }
}
