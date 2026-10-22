using System.Runtime.InteropServices;
using Gymli.Checkin.Core;
using Gymli.Checkin.Core.Hardware;

namespace Gymli.Checkin.Hardware.ZkTeco;

/// <summary>
/// ZKTeco USB fingerprint readers (ZK9500, ZK6500, ZK8500R, SLK20R) via the free ZKFinger SDK 5.x
/// C API (libzkfp.dll: device, ZKFinger 10.0 templates, enrolment merge and 1:N identification).
/// libzkfp.dll comes with ZKTeco's "Fingerprint Reader Standard Driver" (ZKFinger SDK setup.exe),
/// which puts it in Windows' system folder; it can also sit next to Gymli.Checkin.exe.
///
/// Privacy: the reader returns the image and its template together; only the template is kept and
/// the image buffer is wiped straight away. Images are never stored or sent.
///
/// Enrolment: the SDK merges 3 scans of the same finger into one template. Gymli takes 4 scans and
/// uses the last 3 that match each other, so one poor scan does not spoil the enrolment.
///
/// STATUS: written against the SDK header (libzkfp.h); first run on a real reader still to come.
/// Every SDK error code is logged (C:\ProgramData\Gymli\logs) so a failed first run can be fixed quickly.
/// </summary>
public sealed class ZkTecoReader : IFingerprintReader
{
    /// <summary>All SDK calls go through this lock: the library is not documented as thread-safe.</summary>
    private readonly object _lib = new();
    private ZkNative? _native;
    private bool _initialised;
    private IntPtr _dev = IntPtr.Zero;
    private IntPtr _db = IntPtr.Zero;
    private int _width, _height;
    private CancellationTokenSource? _watchCts;
    /// <summary>
    /// Set after a scan: the reader keeps returning the same finger while it rests on the glass, so the
    /// next capture first waits for it to be lifted (one long press must not count as two scans).
    /// </summary>
    private bool _needLift;

    /// <summary>The templates loaded in the SDK's 1:N cache: member id → (cache id, template).</summary>
    private readonly Dictionary<string, (uint Fid, byte[] Fmd)> _cached = new();
    private readonly Dictionary<uint, string> _byFid = new();
    private uint _nextFid = 1;

    private const int TemplateSize = 2048;
    private const int DefaultWidth = 300, DefaultHeight = 400; // ZK9500 image size
    /// <summary>Scans the SDK merges into one enrolment template.</summary>
    public const int MergeScans = 3;
    /// <summary>After this many unusual capture errors in a row the reader is closed and opened again.</summary>
    private const int MaxCaptureErrors = 25;

    public string Name { get; private set; } = "ZKTeco reader";
    public bool IsConnected { get { lock (_lib) return _dev != IntPtr.Zero; } }
    public event EventHandler<bool>? ConnectionChanged;

    public Task StartAsync(CancellationToken ct)
    {
        lock (_lib)
        {
            _native = ZkNative.Load(); // throws DllNotFoundException when the driver is not installed
            Init();
        }
        _watchCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _ = Task.Run(() => WatchAsync(_watchCts.Token));
        return Task.CompletedTask;
    }

    /// <summary>Starts the library and its 1:N cache. Caller holds <see cref="_lib"/>.</summary>
    private void Init()
    {
        var rc = _native!.Init();
        if (rc != ZkNative.OK && rc != ZkNative.ALREADY_INIT) { Log.Warn($"ZKTeco library did not start ({ZkNative.Describe(rc)})"); return; }
        _initialised = true;
        _db = _native.DBInit();
        if (_db == IntPtr.Zero) Log.Warn("ZKTeco fingerprint cache could not be created");
        _cached.Clear();
        _byFid.Clear();
    }

    /// <summary>Releases the library. Caller holds <see cref="_lib"/>.</summary>
    private void Terminate()
    {
        if (_db != IntPtr.Zero) { try { _native!.DBFree(_db); } catch { } _db = IntPtr.Zero; }
        if (_initialised) { try { _native!.Terminate(); } catch { } _initialised = false; }
        _cached.Clear();
        _byFid.Clear();
    }

    /// <summary>Keeps trying to open the reader, so an unplugged reader comes back by itself.</summary>
    private async Task WatchAsync(CancellationToken ct)
    {
        var missing = 0;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                if (!IsConnected) TryOpen();
                else
                {
                    // Unplugged? The SDK stops counting the reader.
                    int count;
                    lock (_lib) count = _native!.GetDeviceCount();
                    missing = count > 0 ? 0 : missing + 1;
                    if (missing >= 2) { Lost("unplugged"); missing = 0; }
                }
            }
            catch (Exception ex) { Log.Error("ZKTeco reader check failed", ex); }
            try { await Task.Delay(2000, ct); } catch (OperationCanceledException) { return; }
        }
    }

    private void TryOpen()
    {
        lock (_lib)
        {
            if (_dev != IntPtr.Zero || _native is null) return;
            if (!_initialised) Init();
            if (!_initialised) return;
            var count = _native.GetDeviceCount();
            if (count <= 0)
            {
                // The SDK only sees readers that were plugged in when it started: restart it to look again.
                Terminate();
                Init();
                if (!_initialised || _native.GetDeviceCount() <= 0) return;
            }
            var dev = _native.OpenDevice(0);
            if (dev == IntPtr.Zero) { Log.Warn("ZKTeco reader found but could not open (in use by another program?)"); return; }
            _dev = dev;
            _width = ReadInt(1) is > 0 and <= 2000 and var w ? w : DefaultWidth;
            _height = ReadInt(2) is > 0 and <= 2000 and var h ? h : DefaultHeight;
            Name = "ZKTeco reader";
            Log.Info($"Fingerprint reader connected: ZKTeco ({_width}×{_height} image)");
        }
        ConnectionChanged?.Invoke(this, true);
    }

    /// <summary>Reads a 4-byte device parameter (1 = image width, 2 = image height). Caller holds <see cref="_lib"/>.</summary>
    private int ReadInt(int code)
    {
        var buf = new byte[4];
        uint size = 4;
        var rc = _native!.GetParameters(_dev, code, buf, ref size);
        return rc == ZkNative.OK ? BitConverter.ToInt32(buf, 0) : -1;
    }

    private void Lost(string why)
    {
        bool was;
        lock (_lib)
        {
            was = _dev != IntPtr.Zero;
            if (was) { try { _native!.CloseDevice(_dev); } catch { } _dev = IntPtr.Zero; }
        }
        if (!was) return;
        Log.Warn($"Fingerprint reader lost: {why}");
        ConnectionChanged?.Invoke(this, false);
    }

    public Task<FingerSample> CaptureAsync(CancellationToken ct) => Task.Run(() => Capture(ct), ct);

    private FingerSample Capture(CancellationToken ct)
    {
        byte[] image = [];
        var fmd = new byte[TemplateSize];
        var errors = 0;
        var seen = new HashSet<int>();
        try
        {
            while (true)
            {
                ct.ThrowIfCancellationRequested();
                int rc;
                uint size = TemplateSize;
                bool lifting;
                lock (_lib)
                {
                    if (_dev == IntPtr.Zero) rc = int.MinValue;
                    else
                    {
                        if (image.Length != _width * _height) image = new byte[_width * _height];
                        // Returns at once: OK with a template when a finger is on the glass, an error code otherwise.
                        rc = _native!.AcquireFingerprint(_dev, image, (uint)image.Length, fmd, ref size);
                        Array.Clear(image); // wipe the image straight away
                    }
                    lifting = _needLift;
                    if (lifting && rc != ZkNative.OK) _needLift = false; // finger lifted: the next one counts
                }
                if (rc == int.MinValue) { Thread.Sleep(300); continue; }
                if (rc == ZkNative.OK && lifting) { Thread.Sleep(100); continue; } // same finger still on the glass
                if (rc == ZkNative.OK && size > 0 && size <= TemplateSize)
                {
                    lock (_lib) _needLift = true;
                    return new FingerSample(fmd[..(int)size]);
                }
                // "No finger yet" is the normal answer. Anything else is noted once, and if it keeps
                // happening the reader is closed so the watcher opens it again.
                if (rc != ZkNative.ERR_CAPTURE && rc != ZkNative.ERR_TIMEOUT && rc != ZkNative.OK)
                {
                    if (seen.Add(rc)) Log.Warn($"ZKTeco capture: {ZkNative.Describe(rc)}");
                    if (++errors >= MaxCaptureErrors) { Lost($"capture errors ({ZkNative.Describe(rc)})"); errors = 0; }
                }
                else errors = 0;
                Thread.Sleep(100);
            }
        }
        finally
        {
            Array.Clear(image);
            Array.Clear(fmd);
        }
    }

    public byte[]? CreateTemplate(IReadOnlyList<FingerSample> samples)
    {
        lock (_lib)
        {
            if (_db == IntPtr.Zero) throw new InvalidOperationException("ZKTeco fingerprint cache not available");
            var pick = PickMatchingScans(samples, (a, b) => _native!.DBMatch(_db, a.Fmd, (uint)a.Fmd.Length, b.Fmd, (uint)b.Fmd.Length) > 0);
            if (pick is null) return null; // the engine asks for another scan
            var reg = new byte[TemplateSize];
            uint size = TemplateSize;
            var rc = _native!.DBMerge(_db, Padded(pick[0]), Padded(pick[1]), Padded(pick[2]), reg, ref size);
            if (rc != ZkNative.OK || size == 0 || size > TemplateSize) { Log.Warn($"Enrolment template not created ({ZkNative.Describe(rc)})"); return null; }
            return reg[..(int)size];
        }
    }

    /// <summary>The SDK reads full-size template buffers in the merge.</summary>
    private static byte[] Padded(FingerSample s)
    {
        var b = new byte[TemplateSize];
        s.Fmd.AsSpan(0, Math.Min(s.Fmd.Length, TemplateSize)).CopyTo(b);
        return b;
    }

    /// <summary>
    /// The newest <see cref="MergeScans"/> scans that all match each other, or null when there are none
    /// (too few scans, or a different finger was used). Newest first, so a retry uses the fresh scans.
    /// </summary>
    public static IReadOnlyList<T>? PickMatchingScans<T>(IReadOnlyList<T> scans, Func<T, T, bool> matches)
    {
        for (var c = scans.Count - 1; c >= 2; c--)
            for (var b = c - 1; b >= 1; b--)
            {
                if (!matches(scans[b], scans[c])) continue;
                for (var a = b - 1; a >= 0; a--)
                    if (matches(scans[a], scans[b]) && matches(scans[a], scans[c])) return [scans[a], scans[b], scans[c]];
            }
        return null;
    }

    public string? Identify(FingerSample sample, IReadOnlyList<StoredTemplate> templates)
    {
        if (templates.Count == 0) return null;
        lock (_lib)
        {
            if (_db == IntPtr.Zero) { Log.Warn("ZKTeco fingerprint cache not available"); return null; }
            LoadCache(templates);
            uint fid = 0, score = 0;
            var rc = _native!.DBIdentify(_db, sample.Fmd, (uint)sample.Fmd.Length, ref fid, ref score);
            if (rc != ZkNative.OK) return null; // no member matched
            return _byFid.TryGetValue(fid, out var id) ? id : null;
        }
    }

    /// <summary>
    /// Brings the SDK's 1:N cache in line with <paramref name="templates"/>: only new, changed and
    /// removed members are touched, so a check-in does not reload 2,000 templates. Caller holds <see cref="_lib"/>.
    /// </summary>
    private void LoadCache(IReadOnlyList<StoredTemplate> templates)
    {
        var wanted = new HashSet<string>();
        foreach (var t in templates)
        {
            wanted.Add(t.MemberId);
            if (_cached.TryGetValue(t.MemberId, out var have) && have.Fmd.AsSpan().SequenceEqual(t.Fmd)) continue;
            if (_cached.Remove(t.MemberId, out have)) { _native!.DBDel(_db, have.Fid); _byFid.Remove(have.Fid); }
            var fid = _nextFid++;
            var rc = _native!.DBAdd(_db, fid, t.Fmd, (uint)t.Fmd.Length);
            if (rc != ZkNative.OK) { Log.Warn($"Template for member {t.MemberId} not loaded ({ZkNative.Describe(rc)})"); continue; }
            _cached[t.MemberId] = (fid, t.Fmd.ToArray());
            _byFid[fid] = t.MemberId;
        }
        foreach (var gone in _cached.Keys.Where(k => !wanted.Contains(k)).ToList())
        {
            var (fid, _) = _cached[gone];
            _native!.DBDel(_db, fid);
            _cached.Remove(gone);
            _byFid.Remove(fid);
        }
    }

    public void Dispose()
    {
        _watchCts?.Cancel();
        Lost("closing");
        lock (_lib)
        {
            if (_native is not null) Terminate();
            foreach (var (_, fmd) in _cached.Values) Array.Clear(fmd);
        }
    }
}

/// <summary>
/// libzkfp.dll (ZKFinger SDK 5.x, libzkfp.h). Functions are looked up by name at start-up; the
/// 1:N cache functions have two names in different SDK builds (ZKFPM_DBInit = ZKFPM_CreateDBCache, …).
/// </summary>
internal sealed class ZkNative
{
    public const int OK = 0;
    public const int ALREADY_INIT = 1;
    public const int ERR_CAPTURE = -8;
    public const int ERR_TIMEOUT = -28;

    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int IntFn();
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate IntPtr OpenFn(int index);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int HandleFn(IntPtr handle);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate IntPtr CreateFn();
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int GetParamFn(IntPtr dev, int code, [Out] byte[] value, ref uint size);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int AcquireFn(IntPtr dev, [Out] byte[] image, uint imageSize, [Out] byte[] fmd, ref uint fmdSize);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int MergeFn(IntPtr db, byte[] t1, byte[] t2, byte[] t3, [Out] byte[] reg, ref uint regSize);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int AddFn(IntPtr db, uint fid, byte[] fmd, uint size);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int DelFn(IntPtr db, uint fid);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int IdentifyFn(IntPtr db, byte[] fmd, uint size, ref uint fid, ref uint score);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] public delegate int MatchFn(IntPtr db, byte[] t1, uint size1, byte[] t2, uint size2);

    public required IntFn Init { get; init; }
    public required IntFn Terminate { get; init; }
    public required IntFn GetDeviceCount { get; init; }
    public required OpenFn OpenDevice { get; init; }
    public required HandleFn CloseDevice { get; init; }
    public required GetParamFn GetParameters { get; init; }
    public required AcquireFn AcquireFingerprint { get; init; }
    public required CreateFn DBInit { get; init; }
    public required HandleFn DBFree { get; init; }
    public required MergeFn DBMerge { get; init; }
    public required AddFn DBAdd { get; init; }
    public required DelFn DBDel { get; init; }
    public required IdentifyFn DBIdentify { get; init; }
    public required MatchFn DBMatch { get; init; }

    public const string Library = "libzkfp";

    /// <summary>Loads libzkfp.dll. Throws DllNotFoundException / EntryPointNotFoundException with a plain message.</summary>
    public static ZkNative Load()
    {
        if (!NativeLibrary.TryLoad(Library, typeof(ZkNative).Assembly, null, out var lib))
            throw new DllNotFoundException("libzkfp.dll not found. Install ZKTeco's Fingerprint Reader Standard Driver (ZKFinger SDK).");
        T Fn<T>(params string[] names) where T : Delegate
        {
            foreach (var n in names)
                if (NativeLibrary.TryGetExport(lib, n, out var p)) return Marshal.GetDelegateForFunctionPointer<T>(p);
            throw new EntryPointNotFoundException($"libzkfp.dll has no {names[0]}: unsupported ZKFinger SDK version");
        }
        return new ZkNative
        {
            Init = Fn<IntFn>("ZKFPM_Init"),
            Terminate = Fn<IntFn>("ZKFPM_Terminate"),
            GetDeviceCount = Fn<IntFn>("ZKFPM_GetDeviceCount"),
            OpenDevice = Fn<OpenFn>("ZKFPM_OpenDevice"),
            CloseDevice = Fn<HandleFn>("ZKFPM_CloseDevice"),
            GetParameters = Fn<GetParamFn>("ZKFPM_GetParameters"),
            AcquireFingerprint = Fn<AcquireFn>("ZKFPM_AcquireFingerprint"),
            DBInit = Fn<CreateFn>("ZKFPM_DBInit", "ZKFPM_CreateDBCache"),
            DBFree = Fn<HandleFn>("ZKFPM_DBFree", "ZKFPM_CloseDBCache"),
            DBMerge = Fn<MergeFn>("ZKFPM_DBMerge", "ZKFPM_GenRegTemplate"),
            DBAdd = Fn<AddFn>("ZKFPM_DBAdd", "ZKFPM_AddRegTemplateToDBCache"),
            DBDel = Fn<DelFn>("ZKFPM_DBDel", "ZKFPM_DelRegTemplateFromDBCache"),
            DBIdentify = Fn<IdentifyFn>("ZKFPM_DBIdentify", "ZKFPM_Identify"),
            DBMatch = Fn<MatchFn>("ZKFPM_DBMatch", "ZKFPM_MatchFinger"),
        };
    }

    /// <summary>SDK error codes (libzkfp_errdef.h) in words, for the log.</summary>
    public static string Describe(int rc) => rc switch
    {
        0 => "OK",
        1 => "already started",
        -1 => "library failed to load",
        -2 => "could not start",
        -3 => "no reader connected",
        -4 => "not supported",
        -5 => "invalid parameter",
        -6 => "could not open the reader",
        -7 => "invalid handle",
        -8 => "no finger read",
        -9 => "could not read the finger",
        -10 => "stopped",
        -11 => "out of memory",
        -12 => "reader busy",
        -13 => "could not add the template",
        -14 => "could not remove the template",
        -17 => "failed",
        -18 => "cancelled",
        -20 => "fingers do not match",
        -22 => "could not merge the scans",
        -23 => "reader not open",
        -24 => "not started",
        -25 => "reader already open",
        -26 => "could not load the image",
        -27 => "could not analyse the image",
        -28 => "timed out",
        _ => $"error {rc}",
    };
}
