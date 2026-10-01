using System.Text.Json.Nodes;
using Gymli.Checkin.Core.Access;
using Gymli.Checkin.Core.Storage;

namespace Gymli.Checkin.Core.Sync;

/// <summary>A fingerprint enrolment asked for from the web app (design 06).</summary>
public sealed record EnrolRequest(string Id, string MemberId, string MemberName, int MemberNumber, string Status, int Step, int CaptureSeq);

/// <summary>
/// Keeps the local copy in step with Firestore every few seconds:
/// members (delta by updatedAt), templates, door-log upload, heartbeat, enrol requests.
/// Every part is safe to repeat; nothing here blocks a check-in.
/// </summary>
public sealed class SyncService
{
    private const string CursorKey = "members.cursor";
    private static readonly TimeSpan CursorOverlap = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan HeartbeatEvery = TimeSpan.FromSeconds(15);

    private readonly FirestoreClient _fs;
    private readonly LocalStore _store;
    private readonly CheckinSettings _settings;
    private readonly Func<(bool reader, bool relay)> _hardware;
    private DateTimeOffset _lastHeartbeat = DateTimeOffset.MinValue;

    public DateTimeOffset LastSuccess { get; private set; } = DateTimeOffset.MinValue;
    public string? LastError { get; private set; }
    /// <summary>Online = the last sync worked and was recent. One failed sync is enough to show "Offline".</summary>
    public bool Online => LastError is null && DateTimeOffset.UtcNow - LastSuccess < TimeSpan.FromSeconds(Math.Max(15, _settings.SyncSeconds * 4));
    public event Action? StatusChanged;
    public event Action<EnrolRequest>? EnrolRequested;

    public SyncService(FirestoreClient fs, LocalStore store, CheckinSettings settings, Func<(bool reader, bool relay)> hardware)
    {
        _fs = fs;
        _store = store;
        _settings = settings;
        _hardware = hardware;
    }

    public async Task RunAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            var wasOnline = Online;
            try
            {
                await SyncOnceAsync(ct);
                LastSuccess = DateTimeOffset.UtcNow;
                LastError = null;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                if (LastError != ex.Message) Log.Warn($"Sync failed, working offline: {ex.Message}");
                LastError = ex.Message;
            }
            if (wasOnline != Online) Log.Info(Online ? "Back online" : "Offline: using saved list");
            StatusChanged?.Invoke();
            try { await Task.Delay(TimeSpan.FromSeconds(_settings.SyncSeconds), ct); } catch (OperationCanceledException) { return; }
        }
    }

    public async Task SyncOnceAsync(CancellationToken ct)
    {
        await PullMembersAsync(ct);
        await PushDoorLogsAsync(ct);
        await PollEnrolRequestsAsync(ct);
        if (DateTimeOffset.UtcNow - _lastHeartbeat > HeartbeatEvery) await HeartbeatAsync(ct);
    }

    /* ---------------- Members ---------------- */

    public async Task PullMembersAsync(CancellationToken ct)
    {
        for (var page = 0; page < 50; page++)
        {
            var cursor = _store.GetState(CursorKey);
            var from = cursor is null ? DateTimeOffset.UnixEpoch : DateTimeOffset.Parse(cursor) - CursorOverlap;
            var query = new JsonObject
            {
                ["from"] = new JsonArray(new JsonObject { ["collectionId"] = "members" }),
                ["where"] = Fs.FieldFilter("updatedAt", "GREATER_THAN", Fs.Time(from)),
                ["orderBy"] = new JsonArray(new JsonObject { ["field"] = new JsonObject { ["fieldPath"] = "updatedAt" }, ["direction"] = "ASCENDING" }),
                ["limit"] = 300,
            };
            var docs = await _fs.RunQueryAsync(query, ct);
            if (docs.Count == 0) return;

            var members = docs.Select(ToMember).ToList();
            _store.UpsertMembers(members);
            foreach (var m in members.Where(m => m.FingerprintEnrolled && !m.Deleted))
            {
                if (_store.HasTemplate(m.Id) && _store.TemplateEnrolledAt(m.Id) == m.FingerprintEnrolledAt) continue;
                await PullTemplateAsync(m, ct);
            }

            var newest = docs.Max(d => DateTimeOffset.Parse(d.Str("updatedAt")!));
            var old = cursor is null ? DateTimeOffset.MinValue : DateTimeOffset.Parse(cursor);
            if (newest > old) _store.SetState(CursorKey, newest.ToString("o"));
            if (docs.Count < 300 || newest <= old) return;
        }
    }

    private async Task PullTemplateAsync(LocalMember m, CancellationToken ct)
    {
        var t = await _fs.GetAsync($"templates/{m.Id}", ct);
        if (t is null) return; // enrolled flag set, but no template (e.g. seeded data)
        var cipher = t.Str("cipher");
        if (cipher is null) return;
        if (t.Str("keyId") is { } kid && kid != _store.KeyId)
        {
            Log.Warn($"Template for {m.Code} was made with another key ({kid}); import that key or re-enrol.");
            return;
        }
        _store.SaveTemplate(m.Id, cipher, t.Str("keyId") ?? _store.KeyId, m.FingerprintEnrolledAt);
    }

    public static LocalMember ToMember(FsDoc d)
    {
        var periods = new List<PeriodDates>();
        if (d.Fields["periods"] is JsonArray arr)
        {
            foreach (var p in arr.OfType<JsonObject>())
            {
                if (p["start"]?.GetValue<string>() is not { } s || p["end"]?.GetValue<string>() is not { } e) continue;
                var deleted = p["deleted"] is JsonValue dv && dv.TryGetValue<bool>(out var b) && b;
                periods.Add(new PeriodDates(DateOnly.Parse(s), DateOnly.Parse(e), deleted));
            }
        }
        var fp = d.Fields["fingerprint"] as JsonObject;
        long fpAt = 0;
        if (fp?["enrolledAt"] is JsonValue fv) fpAt = fv.TryGetValue<long>(out var l) ? l : fv.TryGetValue<double>(out var dd) ? (long)dd : 0;
        return new LocalMember(d.Id, (int)d.Long("number"), d.Str("firstName") ?? "", d.Str("lastName") ?? "", periods, fp is not null, fpAt, d.Bool("deleted"));
    }

    /* ---------------- Door log ---------------- */

    public async Task PushDoorLogsAsync(CancellationToken ct)
    {
        foreach (var log in _store.PendingLogs(100))
        {
            var fields = new JsonObject
            {
                ["deviceId"] = Fs.Str(_fs.Uid),
                ["memberId"] = Fs.Str(log.MemberId),
                ["memberName"] = Fs.Str(log.MemberName),
                ["memberNumber"] = log.MemberNumber is { } n ? Fs.Int(n) : Fs.Null(),
                ["result"] = Fs.Str(log.Allowed ? "allowed" : "denied"),
                ["reason"] = Fs.Str(log.Reason),
                ["text"] = Fs.Str(log.Text),
                ["paidUntil"] = Fs.Str(log.PaidUntil),
                ["at"] = Fs.Int(log.AtMs),
                ["date"] = Fs.Str(log.Date),
                ["offline"] = Fs.Bool(log.Offline),
            };
            var write = new JsonObject
            {
                ["update"] = new JsonObject { ["name"] = _fs.DocName($"doorLogs/{log.Id}"), ["fields"] = fields },
                ["currentDocument"] = new JsonObject { ["exists"] = false },
            };
            try
            {
                await _fs.CommitAsync(new JsonArray(write), ct);
            }
            catch (SyncException ex) when (ex.Status is "ALREADY_EXISTS" or "FAILED_PRECONDITION")
            {
                // uploaded before the connection dropped — fine
            }
            _store.MarkUploaded(log.Id);
        }
    }

    /* ---------------- Heartbeat ---------------- */

    public async Task HeartbeatAsync(CancellationToken ct)
    {
        await TokenWarmup(ct);
        var (reader, relay) = _hardware();
        var fields = new JsonObject
        {
            ["name"] = Fs.Str(_settings.DeviceName),
            ["lastSeenAt"] = Fs.Int(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()),
            ["mode"] = Fs.Str(_settings.Simulation ? "simulation" : "hardware"),
            ["readerConnected"] = Fs.Bool(reader),
            ["relayConnected"] = Fs.Bool(relay),
            ["pendingLogs"] = Fs.Int(_store.PendingCount),
            ["members"] = Fs.Int(_store.MemberCount),
            ["appVersion"] = Fs.Str(typeof(SyncService).Assembly.GetName().Version?.ToString(3) ?? "1.0.0"),
        };
        await _fs.CommitAsync(new JsonArray(new JsonObject { ["update"] = new JsonObject { ["name"] = _fs.DocName($"devices/{_fs.Uid}"), ["fields"] = fields } }), ct);
        _lastHeartbeat = DateTimeOffset.UtcNow;
    }

    private async Task TokenWarmup(CancellationToken ct)
    {
        if (_fs.Uid is null) await _fs.GetAsync("config/bootstrap", ct);
    }

    /* ---------------- Enrolment requests ---------------- */

    private readonly HashSet<string> _announced = new();

    public async Task PollEnrolRequestsAsync(CancellationToken ct)
    {
        var docs = await _fs.RunQueryAsync(new JsonObject
        {
            ["from"] = new JsonArray(new JsonObject { ["collectionId"] = "enrolRequests" }),
            ["where"] = Fs.FieldFilter("status", "EQUAL", Fs.Str("pending")),
            ["limit"] = 5,
        }, ct);
        foreach (var d in docs)
        {
            if (!_announced.Add(d.Id)) continue;
            // Ignore stale requests (left open in a browser) older than 10 minutes
            if (d.Str("createdAt") is { } c && DateTimeOffset.Parse(c) < DateTimeOffset.UtcNow.AddMinutes(-10)) continue;
            EnrolRequested?.Invoke(ToEnrol(d));
        }
    }

    public async Task<EnrolRequest?> GetEnrolAsync(string id, CancellationToken ct)
    {
        var d = await _fs.GetAsync($"enrolRequests/{id}", ct);
        return d is null ? null : ToEnrol(d);
    }

    private static EnrolRequest ToEnrol(FsDoc d) =>
        new(d.Id, d.Str("memberId") ?? "", d.Str("memberName") ?? "", (int)d.Long("memberNumber"), d.Str("status") ?? "", (int)d.Long("step"), (int)d.Long("captureSeq"));

    public Task UpdateEnrolAsync(string id, string status, int step, string message, CancellationToken ct)
    {
        var write = new JsonObject
        {
            ["update"] = new JsonObject
            {
                ["name"] = _fs.DocName($"enrolRequests/{id}"),
                ["fields"] = new JsonObject { ["status"] = Fs.Str(status), ["step"] = Fs.Int(step), ["message"] = Fs.Str(message) },
            },
            ["updateMask"] = new JsonObject { ["fieldPaths"] = new JsonArray("status", "step", "message") },
            ["updateTransforms"] = new JsonArray(Fs.ServerTime("updatedAt")),
        };
        return _fs.CommitAsync(new JsonArray(write), ct);
    }

    /// <summary>Uploads the encrypted template and marks the member enrolled, with an audit entry, in one commit.</summary>
    public async Task SaveEnrolmentAsync(string memberId, int memberNumber, string cipher, long enrolledAt, string finger, CancellationToken ct)
    {
        var auditId = Guid.NewGuid().ToString("N");
        var writes = new JsonArray(
            new JsonObject
            {
                ["update"] = new JsonObject
                {
                    ["name"] = _fs.DocName($"templates/{memberId}"),
                    ["fields"] = new JsonObject
                    {
                        ["memberId"] = Fs.Str(memberId),
                        ["cipher"] = Fs.Str(cipher),
                        ["keyId"] = Fs.Str(_store.KeyId),
                        ["format"] = Fs.Str(_settings.Simulation ? "simulated" : "ansi-378-2004"),
                        ["finger"] = Fs.Str(finger),
                        ["enrolledAt"] = Fs.Int(enrolledAt),
                    },
                },
                ["updateTransforms"] = new JsonArray(Fs.ServerTime("updatedAt")),
            },
            new JsonObject
            {
                ["update"] = new JsonObject
                {
                    ["name"] = _fs.DocName($"audit/{auditId}"),
                    ["fields"] = new JsonObject
                    {
                        ["actor"] = Fs.Map(new JsonObject { ["uid"] = Fs.Str(_fs.Uid), ["name"] = Fs.Str(_settings.DeviceName), ["role"] = Fs.Str("device") }),
                        ["action"] = Fs.Str("fingerprint.enrol"),
                        ["entity"] = Fs.Str("member"),
                        ["entityId"] = Fs.Str(memberId),
                        ["summary"] = Fs.Str($"Enrolled fingerprint for GY-{memberNumber}"),
                        ["before"] = Fs.Null(),
                        ["after"] = Fs.Null(),
                    },
                },
                ["updateTransforms"] = new JsonArray(Fs.ServerTime("at")),
                ["currentDocument"] = new JsonObject { ["exists"] = false },
            },
            new JsonObject
            {
                ["update"] = new JsonObject
                {
                    ["name"] = _fs.DocName($"members/{memberId}"),
                    ["fields"] = new JsonObject
                    {
                        ["fingerprint"] = Fs.Map(new JsonObject { ["finger"] = Fs.Str(finger), ["enrolledAt"] = Fs.Int(enrolledAt) }),
                        ["lastAuditId"] = Fs.Str(auditId),
                    },
                },
                ["updateMask"] = new JsonObject { ["fieldPaths"] = new JsonArray("fingerprint", "lastAuditId") },
                ["updateTransforms"] = new JsonArray(Fs.ServerTime("updatedAt")),
                ["currentDocument"] = new JsonObject { ["exists"] = true },
            });
        await _fs.CommitAsync(writes, ct);
    }
}
