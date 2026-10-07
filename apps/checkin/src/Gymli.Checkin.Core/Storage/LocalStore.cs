using System.Text.Json;
using Gymli.Checkin.Core.Access;
using Gymli.Checkin.Core.Security;
using Microsoft.Data.Sqlite;

namespace Gymli.Checkin.Core.Storage;

/// <summary>
/// Local SQLite copy of members, paid periods and (encrypted) fingerprint templates,
/// plus the queue of door logs waiting to upload. Check-ins only ever read from here,
/// so they are instant and keep working offline.
/// </summary>
public sealed class LocalStore : IDisposable
{
    private readonly SqliteConnection _db;
    private readonly TemplateProtector _protector;
    private readonly object _gate = new();

    // In-memory caches for fast 1:N identification
    private Dictionary<string, LocalMember> _members = new();
    private List<StoredTemplate> _templates = new();

    public LocalStore(string path, TemplateProtector protector)
    {
        _protector = protector;
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        _db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ToString());
        _db.Open();
        Exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
        Exec("""
            CREATE TABLE IF NOT EXISTS members (
              id TEXT PRIMARY KEY, number INTEGER NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
              periods TEXT NOT NULL, fingerprint INTEGER NOT NULL, fingerprint_at INTEGER NOT NULL, deleted INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS templates (
              member_id TEXT PRIMARY KEY, cipher TEXT NOT NULL, key_id TEXT NOT NULL, enrolled_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS outbox (
              id TEXT PRIMARY KEY, body TEXT NOT NULL, created INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            """);
        Reload();
    }

    private void Exec(string sql, params (string, object?)[] args)
    {
        lock (_gate)
        {
            using var cmd = _db.CreateCommand();
            cmd.CommandText = sql;
            foreach (var (k, v) in args) cmd.Parameters.AddWithValue(k, v ?? DBNull.Value);
            cmd.ExecuteNonQuery();
        }
    }

    /* ---------------- Members ---------------- */

    public IReadOnlyCollection<LocalMember> Members { get { lock (_gate) return _members.Values.Where(m => !m.Deleted).ToList(); } }
    public int MemberCount { get { lock (_gate) return _members.Values.Count(m => !m.Deleted); } }

    public LocalMember? GetMember(string id) { lock (_gate) return _members.GetValueOrDefault(id) is { Deleted: false } m ? m : null; }

    public void UpsertMembers(IEnumerable<LocalMember> members)
    {
        lock (_gate)
        {
            using var tx = _db.BeginTransaction();
            foreach (var m in members)
            {
                using var cmd = _db.CreateCommand();
                cmd.Transaction = tx;
                cmd.CommandText = """
                    INSERT INTO members (id, number, first_name, last_name, periods, fingerprint, fingerprint_at, deleted)
                    VALUES ($id, $n, $f, $l, $p, $fp, $fpa, $d)
                    ON CONFLICT(id) DO UPDATE SET number=$n, first_name=$f, last_name=$l, periods=$p, fingerprint=$fp, fingerprint_at=$fpa, deleted=$d
                    """;
                cmd.Parameters.AddWithValue("$id", m.Id);
                cmd.Parameters.AddWithValue("$n", m.Number);
                cmd.Parameters.AddWithValue("$f", m.Deleted ? "" : m.FirstName);
                cmd.Parameters.AddWithValue("$l", m.Deleted ? "" : m.LastName);
                cmd.Parameters.AddWithValue("$p", JsonSerializer.Serialize(m.Periods.Select(p => new[] { p.Start.ToString("yyyy-MM-dd"), p.End.ToString("yyyy-MM-dd"), p.Deleted ? "deleted" : "" })));
                cmd.Parameters.AddWithValue("$fp", m.FingerprintEnrolled ? 1 : 0);
                cmd.Parameters.AddWithValue("$fpa", m.FingerprintEnrolledAt);
                cmd.Parameters.AddWithValue("$d", m.Deleted ? 1 : 0);
                cmd.ExecuteNonQuery();
                // Removed member, or fingerprint cleared: erase the template here too (POPIA).
                if (m.Deleted || !m.FingerprintEnrolled) DeleteTemplateLocked(m.Id, tx);
                _members[m.Id] = m;
            }
            tx.Commit();
            LoadTemplatesLocked();
        }
    }

    /// <summary>Forgets every member and template (this PC was moved to another branch).</summary>
    public void ClearMembers()
    {
        lock (_gate)
        {
            Exec("DELETE FROM members; DELETE FROM templates; DELETE FROM state WHERE key='members.cursor';");
            _members.Clear();
            LoadTemplatesLocked();
        }
    }

    /* ---------------- Templates ---------------- */

    public IReadOnlyList<StoredTemplate> Templates { get { lock (_gate) return _templates; } }

    public bool HasTemplate(string memberId) { lock (_gate) return _templates.Any(t => t.MemberId == memberId); }

    public long TemplateEnrolledAt(string memberId)
    {
        lock (_gate)
        {
            using var cmd = _db.CreateCommand();
            cmd.CommandText = "SELECT enrolled_at FROM templates WHERE member_id=$id";
            cmd.Parameters.AddWithValue("$id", memberId);
            return cmd.ExecuteScalar() is long v ? v : 0;
        }
    }

    /// <summary>Stores an already-encrypted template (as downloaded, or after enrolment).</summary>
    public void SaveTemplate(string memberId, string cipher, string keyId, long enrolledAt)
    {
        Exec("INSERT INTO templates (member_id, cipher, key_id, enrolled_at) VALUES ($id,$c,$k,$a) ON CONFLICT(member_id) DO UPDATE SET cipher=$c, key_id=$k, enrolled_at=$a",
            ("$id", memberId), ("$c", cipher), ("$k", keyId), ("$a", enrolledAt));
        lock (_gate) LoadTemplatesLocked();
    }

    public void DeleteTemplate(string memberId)
    {
        lock (_gate)
        {
            DeleteTemplateLocked(memberId, null);
            LoadTemplatesLocked();
        }
    }

    private void DeleteTemplateLocked(string memberId, SqliteTransaction? tx)
    {
        using var cmd = _db.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "DELETE FROM templates WHERE member_id=$id";
        cmd.Parameters.AddWithValue("$id", memberId);
        cmd.ExecuteNonQuery();
    }

    public string Encrypt(byte[] fmd) => _protector.Encrypt(fmd);
    public string KeyId => _protector.KeyId;

    /* ---------------- Outbox (door logs waiting to upload) ---------------- */

    public void Enqueue(DoorLogEntry log) =>
        Exec("INSERT OR IGNORE INTO outbox (id, body, created) VALUES ($id, $b, $c)", ("$id", log.Id), ("$b", JsonSerializer.Serialize(log)), ("$c", log.AtMs));

    public IReadOnlyList<DoorLogEntry> PendingLogs(int max = 50)
    {
        lock (_gate)
        {
            using var cmd = _db.CreateCommand();
            cmd.CommandText = "SELECT body FROM outbox ORDER BY created LIMIT $m";
            cmd.Parameters.AddWithValue("$m", max);
            using var r = cmd.ExecuteReader();
            var list = new List<DoorLogEntry>();
            while (r.Read()) list.Add(JsonSerializer.Deserialize<DoorLogEntry>(r.GetString(0))!);
            return list;
        }
    }

    public int PendingCount
    {
        get
        {
            lock (_gate)
            {
                using var cmd = _db.CreateCommand();
                cmd.CommandText = "SELECT COUNT(*) FROM outbox";
                return Convert.ToInt32(cmd.ExecuteScalar());
            }
        }
    }

    public void MarkUploaded(string id) => Exec("DELETE FROM outbox WHERE id=$id", ("$id", id));

    /* ---------------- Sync state ---------------- */

    public string? GetState(string key)
    {
        lock (_gate)
        {
            using var cmd = _db.CreateCommand();
            cmd.CommandText = "SELECT value FROM state WHERE key=$k";
            cmd.Parameters.AddWithValue("$k", key);
            return cmd.ExecuteScalar() as string;
        }
    }

    public void SetState(string key, string value) =>
        Exec("INSERT INTO state (key, value) VALUES ($k,$v) ON CONFLICT(key) DO UPDATE SET value=$v", ("$k", key), ("$v", value));

    /* ---------------- Loading ---------------- */

    private void Reload()
    {
        lock (_gate)
        {
            var map = new Dictionary<string, LocalMember>();
            using (var cmd = _db.CreateCommand())
            {
                cmd.CommandText = "SELECT id, number, first_name, last_name, periods, fingerprint, fingerprint_at, deleted FROM members";
                using var r = cmd.ExecuteReader();
                while (r.Read())
                {
                    var periods = JsonSerializer.Deserialize<string[][]>(r.GetString(4))!
                        .Select(p => new PeriodDates(DateOnly.Parse(p[0]), DateOnly.Parse(p[1]), p.Length > 2 && p[2] == "deleted")).ToList();
                    var m = new LocalMember(r.GetString(0), r.GetInt32(1), r.GetString(2), r.GetString(3), periods, r.GetInt32(5) == 1, r.GetInt64(6), r.GetInt32(7) == 1);
                    map[m.Id] = m;
                }
            }
            _members = map;
            LoadTemplatesLocked();
        }
    }

    private void LoadTemplatesLocked()
    {
        var list = new List<StoredTemplate>();
        using var cmd = _db.CreateCommand();
        cmd.CommandText = "SELECT member_id, cipher FROM templates";
        using var r = cmd.ExecuteReader();
        while (r.Read())
        {
            var id = r.GetString(0);
            if (_members.TryGetValue(id, out var m) && m.Deleted) continue;
            try { list.Add(new StoredTemplate(id, _protector.Decrypt(r.GetString(1)))); }
            catch (Exception ex) { Log.Warn($"Template for {id} could not be decrypted ({ex.GetType().Name}). Re-enrol this member."); }
        }
        _templates = list;
    }

    public void Dispose() => _db.Dispose();
}
