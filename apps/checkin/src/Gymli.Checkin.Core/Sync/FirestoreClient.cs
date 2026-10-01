using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Gymli.Checkin.Core.Sync;

/// <summary>
/// Minimal Firebase Auth + Firestore REST client. The check-in PC signs in with its own
/// "check-in" login, so firestore.rules apply exactly as for staff (no admin keys on the PC).
/// </summary>
public sealed class FirestoreClient : IDisposable
{
    private readonly HttpClient _http;
    private readonly CheckinSettings _s;
    private string? _idToken;
    private string? _refreshToken;
    private DateTimeOffset _expires;
    private readonly SemaphoreSlim _authGate = new(1, 1);

    public string? Uid { get; private set; }

    public FirestoreClient(CheckinSettings settings, HttpMessageHandler? handler = null)
    {
        _s = settings;
        _http = handler is null ? new HttpClient() : new HttpClient(handler);
        _http.Timeout = TimeSpan.FromSeconds(15);
    }

    private string AuthBase => _s.EmulatorHost is { Length: > 0 } h ? $"http://{h}:9099/identitytoolkit.googleapis.com/v1" : "https://identitytoolkit.googleapis.com/v1";
    private string TokenBase => _s.EmulatorHost is { Length: > 0 } h ? $"http://{h}:9099/securetoken.googleapis.com/v1" : "https://securetoken.googleapis.com/v1";
    private string DocsBase => (_s.EmulatorHost is { Length: > 0 } h ? $"http://{h}:8080/v1" : "https://firestore.googleapis.com/v1") + $"/projects/{_s.FirebaseProjectId}/databases/(default)/documents";
    public string DocName(string path) => $"projects/{_s.FirebaseProjectId}/databases/(default)/documents/{path}";

    /* ---------------- Auth ---------------- */

    private async Task<string> TokenAsync(CancellationToken ct)
    {
        await _authGate.WaitAsync(ct);
        try
        {
            if (_idToken is not null && DateTimeOffset.UtcNow < _expires) return _idToken;
            JsonNode? res;
            if (_refreshToken is not null)
            {
                var form = new FormUrlEncodedContent(new Dictionary<string, string> { ["grant_type"] = "refresh_token", ["refresh_token"] = _refreshToken });
                var r = await _http.PostAsync($"{TokenBase}/token?key={_s.FirebaseApiKey}", form, ct);
                if (r.IsSuccessStatusCode)
                {
                    res = JsonNode.Parse(await r.Content.ReadAsStringAsync(ct));
                    Set(res!["id_token"]!.GetValue<string>(), res["refresh_token"]!.GetValue<string>(), res["expires_in"]!.GetValue<string>(), res["user_id"]!.GetValue<string>());
                    return _idToken!;
                }
                _refreshToken = null;
            }
            if (string.IsNullOrEmpty(_s.DeviceEmail)) throw new SyncException("No check-in login set. Add DeviceEmail and DevicePassword in appsettings.json.");
            var resp = await _http.PostAsJsonAsync($"{AuthBase}/accounts:signInWithPassword?key={_s.FirebaseApiKey}",
                new { email = _s.DeviceEmail, password = _s.DevicePassword, returnSecureToken = true }, ct);
            var body = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode) throw new SyncException($"Check-in login refused ({Short(body)})", authFailed: true);
            res = JsonNode.Parse(body);
            Set(res!["idToken"]!.GetValue<string>(), res["refreshToken"]!.GetValue<string>(), res["expiresIn"]!.GetValue<string>(), res["localId"]!.GetValue<string>());
            return _idToken!;
        }
        finally
        {
            _authGate.Release();
        }

        void Set(string id, string refresh, string expiresIn, string uid)
        {
            _idToken = id;
            _refreshToken = refresh;
            _expires = DateTimeOffset.UtcNow.AddSeconds(int.Parse(expiresIn) - 120);
            Uid = uid;
        }
    }

    private async Task<JsonNode?> SendAsync(HttpMethod method, string url, object? body, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(method, url);
        req.Headers.Authorization = new("Bearer", await TokenAsync(ct));
        if (body is not null) req.Content = new StringContent(body is JsonNode n ? n.ToJsonString() : JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        using var resp = await _http.SendAsync(req, ct);
        var text = await resp.Content.ReadAsStringAsync(ct);
        if (resp.StatusCode == System.Net.HttpStatusCode.NotFound && method == HttpMethod.Get) return null;
        if (!resp.IsSuccessStatusCode)
        {
            var status = JsonNode.Parse(text.Length > 0 ? text : "{}")?["error"]?["status"]?.GetValue<string>() ?? resp.StatusCode.ToString();
            throw new SyncException($"{status}: {Short(text)}", status: status);
        }
        return text.Length > 0 ? JsonNode.Parse(text) : null;
    }

    private static string Short(string s) => s.Length > 300 ? s[..300] : s;

    /* ---------------- Documents ---------------- */

    public async Task<IReadOnlyList<FsDoc>> RunQueryAsync(JsonObject structuredQuery, CancellationToken ct)
    {
        var res = await SendAsync(HttpMethod.Post, $"{DocsBase}:runQuery", new JsonObject { ["structuredQuery"] = structuredQuery }, ct);
        var list = new List<FsDoc>();
        foreach (var item in res?.AsArray() ?? [])
        {
            if (item?["document"] is JsonObject d) list.Add(FsDoc.From(d));
        }
        return list;
    }

    public async Task<FsDoc?> GetAsync(string path, CancellationToken ct)
    {
        var res = await SendAsync(HttpMethod.Get, $"{DocsBase}/{path}", null, ct);
        return res is JsonObject o ? FsDoc.From(o) : null;
    }

    /// <summary>Atomic commit of several writes (the rules see them together).</summary>
    public Task CommitAsync(JsonArray writes, CancellationToken ct) =>
        SendAsync(HttpMethod.Post, $"{DocsBase}:commit", new JsonObject { ["writes"] = writes }, ct);

    public void Dispose() => _http.Dispose();
}

public sealed class SyncException(string message, bool authFailed = false, string? status = null) : Exception(message)
{
    public bool AuthFailed { get; } = authFailed;
    public string? Status { get; } = status;
}

/// <summary>A Firestore document with its fields decoded to plain JSON.</summary>
public sealed record FsDoc(string Name, string Id, JsonObject Fields, string? UpdateTime)
{
    public static FsDoc From(JsonObject d)
    {
        var name = d["name"]!.GetValue<string>();
        var fields = new JsonObject();
        if (d["fields"] is JsonObject f)
            foreach (var (k, v) in f) fields[k] = Fs.Decode(v);
        return new FsDoc(name, name[(name.LastIndexOf('/') + 1)..], fields, d["updateTime"]?.GetValue<string>());
    }

    public string? Str(string k) => Fields[k] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
    public long Long(string k) => Fields[k] is JsonValue v ? (v.TryGetValue<long>(out var l) ? l : v.TryGetValue<double>(out var d) ? (long)d : 0) : 0;
    public bool Bool(string k) => Fields[k] is JsonValue v && v.TryGetValue<bool>(out var b) && b;
}

/// <summary>Encodes/decodes Firestore REST "Value" JSON.</summary>
public static class Fs
{
    public static JsonNode? Decode(JsonNode? v)
    {
        if (v is not JsonObject o) return null;
        if (o["stringValue"] is { } s) return JsonValue.Create(s.GetValue<string>());
        if (o["integerValue"] is { } i) return JsonValue.Create(long.Parse(i.GetValue<string>()));
        if (o["doubleValue"] is { } d) return JsonValue.Create(d.GetValue<double>());
        if (o["booleanValue"] is { } b) return JsonValue.Create(b.GetValue<bool>());
        if (o["timestampValue"] is { } t) return JsonValue.Create(t.GetValue<string>());
        if (o.ContainsKey("nullValue")) return null;
        if (o["mapValue"] is JsonObject m)
        {
            var res = new JsonObject();
            if (m["fields"] is JsonObject mf) foreach (var (k, val) in mf) res[k] = Decode(val);
            return res;
        }
        if (o["arrayValue"] is JsonObject a)
        {
            var res = new JsonArray();
            if (a["values"] is JsonArray vals) foreach (var val in vals) res.Add(Decode(val));
            return res;
        }
        return null;
    }

    public static JsonObject Str(string? s) => s is null ? Null() : new() { ["stringValue"] = s };
    public static JsonObject Int(long i) => new() { ["integerValue"] = i.ToString() };
    public static JsonObject Bool(bool b) => new() { ["booleanValue"] = b };
    public static JsonObject Null() => new() { ["nullValue"] = null };
    public static JsonObject Time(DateTimeOffset t) => new() { ["timestampValue"] = t.UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ss.ffffffZ") };
    public static JsonObject Map(JsonObject fields) => new() { ["mapValue"] = new JsonObject { ["fields"] = fields } };
    public static JsonObject Array(IEnumerable<JsonObject> values) => new() { ["arrayValue"] = new JsonObject { ["values"] = new JsonArray(values.Cast<JsonNode>().ToArray()) } };

    public static JsonObject ServerTime(string fieldPath) => new() { ["fieldPath"] = fieldPath, ["setToServerValue"] = "REQUEST_TIME" };

    public static JsonObject FieldFilter(string field, string op, JsonObject value) => new()
    {
        ["fieldFilter"] = new JsonObject { ["field"] = new JsonObject { ["fieldPath"] = field }, ["op"] = op, ["value"] = value },
    };
}
