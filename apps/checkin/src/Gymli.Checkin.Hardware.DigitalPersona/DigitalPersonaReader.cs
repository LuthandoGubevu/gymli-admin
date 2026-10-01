using System.Runtime.InteropServices;
using Gymli.Checkin.Core;
using Gymli.Checkin.Core.Hardware;

namespace Gymli.Checkin.Hardware.DigitalPersona;

/// <summary>
/// HID DigitalPersona 4500 via the U.are.U SDK 3 C API (dpfpdd.dll for the device,
/// dpfj.dll for feature extraction, enrolment and 1:N identification).
/// The DLLs come with the HID U.are.U SDK / runtime installer and must be on the PATH
/// or next to Gymli.Checkin.App.exe.
///
/// Privacy: the captured image (FID) is turned into a feature set (FMD) straight away
/// and the image buffer is wiped. Images are never stored or sent.
///
/// STATUS: written against the SDK headers; must be verified on the real reader (Week 3).
/// </summary>
public sealed class DigitalPersonaReader : IFingerprintReader
{
    private IntPtr _dev = IntPtr.Zero;
    private string? _devName;
    private readonly object _gate = new();
    private bool _initialised;
    private CancellationTokenSource? _watchCts;
    private const uint Resolution = 500; // 4500 reader: 512 dpi native, 500 dpi output

    /// <summary>False-accept rate 1 in 100 000 — the SDK's recommended identification threshold.</summary>
    private const uint Threshold = Native.DPFJ_PROBABILITY_ONE / 100_000;

    public string Name => _devName is null ? "DigitalPersona reader" : $"DigitalPersona ({_devName})";
    public bool IsConnected { get { lock (_gate) return _dev != IntPtr.Zero; } }
    public event EventHandler<bool>? ConnectionChanged;

    public Task StartAsync(CancellationToken ct)
    {
        var rc = Native.dpfpdd_init();
        if (rc != Native.DPFPDD_SUCCESS) throw new InvalidOperationException($"DigitalPersona SDK did not start (0x{rc:X8}). Is the U.are.U runtime installed?");
        _initialised = true;
        _watchCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _ = Task.Run(() => WatchAsync(_watchCts.Token));
        return Task.CompletedTask;
    }

    /// <summary>Keeps trying to open the reader, so an unplugged reader comes back by itself.</summary>
    private async Task WatchAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            if (!IsConnected) TryOpen();
            try { await Task.Delay(2000, ct); } catch (OperationCanceledException) { return; }
        }
    }

    private void TryOpen()
    {
        try
        {
            uint count = 0;
            var rc = Native.dpfpdd_query_devices(ref count, IntPtr.Zero);
            if (count == 0) return;
            var size = Marshal.SizeOf<Native.DPFPDD_DEV_INFO>();
            var buf = Marshal.AllocHGlobal(size * (int)count);
            try
            {
                for (var i = 0; i < count; i++) Marshal.WriteInt32(buf + i * size, size);
                rc = Native.dpfpdd_query_devices(ref count, buf);
                if (rc != Native.DPFPDD_SUCCESS || count == 0) return;
                var info = Marshal.PtrToStructure<Native.DPFPDD_DEV_INFO>(buf);
                rc = Native.dpfpdd_open(info.name, out var dev);
                if (rc != Native.DPFPDD_SUCCESS) { Log.Warn($"Reader found but could not open (0x{rc:X8})"); return; }
                lock (_gate) { _dev = dev; _devName = info.descr.product_name; }
                Log.Info($"Fingerprint reader connected: {info.descr.product_name}");
                ConnectionChanged?.Invoke(this, true);
            }
            finally
            {
                Marshal.FreeHGlobal(buf);
            }
        }
        catch (DllNotFoundException ex)
        {
            Log.Error("DigitalPersona DLLs not found (dpfpdd.dll / dpfj.dll)", ex);
        }
    }

    private void Lost(string why)
    {
        IntPtr dev;
        lock (_gate) { dev = _dev; _dev = IntPtr.Zero; }
        if (dev != IntPtr.Zero)
        {
            try { Native.dpfpdd_close(dev); } catch { }
            Log.Warn($"Fingerprint reader lost: {why}");
            ConnectionChanged?.Invoke(this, false);
        }
    }

    public Task<FingerSample> CaptureAsync(CancellationToken ct) => Task.Run(() => Capture(ct), ct);

    private FingerSample Capture(CancellationToken ct)
    {
        var image = new byte[512 * 1024];
        try
        {
            while (true)
            {
                ct.ThrowIfCancellationRequested();
                IntPtr dev;
                lock (_gate) dev = _dev;
                if (dev == IntPtr.Zero) { Thread.Sleep(300); continue; }

                var param = new Native.DPFPDD_CAPTURE_PARAM
                {
                    size = (uint)Marshal.SizeOf<Native.DPFPDD_CAPTURE_PARAM>(),
                    image_fmt = Native.DPFPDD_IMG_FMT_ANSI381,
                    image_proc = Native.DPFPDD_IMG_PROC_DEFAULT,
                    image_res = Resolution,
                };
                var result = new Native.DPFPDD_CAPTURE_RESULT { size = (uint)Marshal.SizeOf<Native.DPFPDD_CAPTURE_RESULT>() };
                result.info.size = (uint)Marshal.SizeOf<Native.DPFPDD_IMAGE_INFO>();
                var imageSize = (uint)image.Length;
                // Short timeout so cancellation (enrolment, shutdown) is noticed quickly.
                var rc = Native.dpfpdd_capture(dev, ref param, 1000, ref result, ref imageSize, image);
                if (rc == Native.DPFPDD_E_MORE_DATA)
                {
                    image = new byte[imageSize];
                    continue;
                }
                if (rc != Native.DPFPDD_SUCCESS)
                {
                    Lost($"capture error 0x{rc:X8}");
                    continue;
                }
                if (result.success == 0 || result.quality != Native.DPFPDD_QUALITY_GOOD) continue; // timed out or poor scan: wait for the next finger

                var fmd = new byte[Native.MAX_FMD_SIZE];
                var fmdSize = (uint)fmd.Length;
                rc = Native.dpfj_create_fmd_from_fid(Native.DPFJ_FID_ANSI_381_2004, image, imageSize, Native.DPFJ_FMD_ANSI_378_2004, fmd, ref fmdSize);
                Array.Clear(image); // wipe the image straight away
                if (rc != Native.DPFJ_SUCCESS) { Log.Warn($"Could not read the finger (0x{rc:X8})"); continue; }
                return new FingerSample(fmd[..(int)fmdSize]);
            }
        }
        finally
        {
            Array.Clear(image);
        }
    }

    public byte[]? CreateTemplate(IReadOnlyList<FingerSample> samples)
    {
        var rc = Native.dpfj_start_enrollment(Native.DPFJ_FMD_ANSI_378_2004);
        if (rc != Native.DPFJ_SUCCESS) throw new InvalidOperationException($"Enrolment could not start (0x{rc:X8})");
        try
        {
            var ready = false;
            foreach (var s in samples)
            {
                rc = Native.dpfj_add_to_enrollment(Native.DPFJ_FMD_ANSI_378_2004, s.Fmd, (uint)s.Fmd.Length, 0);
                if (rc == Native.DPFJ_SUCCESS) { ready = true; break; }
                if (rc != Native.DPFJ_E_MORE_DATA) return null;
            }
            if (!ready) return null; // the scans were not similar enough
            uint size = 0;
            Native.dpfj_create_enrollment_fmd(null, ref size);
            var fmd = new byte[size];
            rc = Native.dpfj_create_enrollment_fmd(fmd, ref size);
            return rc == Native.DPFJ_SUCCESS ? fmd[..(int)size] : null;
        }
        finally
        {
            Native.dpfj_finish_enrollment();
        }
    }

    public string? Identify(FingerSample sample, IReadOnlyList<StoredTemplate> templates)
    {
        if (templates.Count == 0) return null;
        var handles = new GCHandle[templates.Count];
        var ptrs = new IntPtr[templates.Count];
        var sizes = new uint[templates.Count];
        try
        {
            for (var i = 0; i < templates.Count; i++)
            {
                handles[i] = GCHandle.Alloc(templates[i].Fmd, GCHandleType.Pinned);
                ptrs[i] = handles[i].AddrOfPinnedObject();
                sizes[i] = (uint)templates[i].Fmd.Length;
            }
            uint candidateCount = 1;
            var candidates = new Native.DPFJ_CANDIDATE[1];
            var rc = Native.dpfj_identify(Native.DPFJ_FMD_ANSI_378_2004, sample.Fmd, (uint)sample.Fmd.Length, 0,
                Native.DPFJ_FMD_ANSI_378_2004, (uint)templates.Count, ptrs, sizes, Threshold, ref candidateCount, candidates);
            if (rc != Native.DPFJ_SUCCESS) { Log.Warn($"Identify error 0x{rc:X8}"); return null; }
            return candidateCount > 0 ? templates[(int)candidates[0].fmd_idx].MemberId : null;
        }
        finally
        {
            foreach (var h in handles) if (h.IsAllocated) h.Free();
        }
    }

    public void Dispose()
    {
        _watchCts?.Cancel();
        Lost("closing");
        if (_initialised) Native.dpfpdd_exit();
    }
}

/// <summary>P/Invoke for the U.are.U SDK 3 (dpfpdd.h, dpfj.h).</summary>
internal static class Native
{
    public const int DPFPDD_SUCCESS = 0;
    public const int DPFJ_SUCCESS = 0;
    private const int Facility = 0x05BA << 16;
    public const int DPFPDD_E_MORE_DATA = Facility | 0x0D;
    public const int DPFJ_E_MORE_DATA = Facility | 0x0D;

    public const uint DPFPDD_IMG_FMT_ANSI381 = 0x001B0401;
    public const uint DPFPDD_IMG_PROC_DEFAULT = 0;
    public const uint DPFPDD_QUALITY_GOOD = 0;
    public const uint DPFJ_FID_ANSI_381_2004 = 0x001B0401;
    public const uint DPFJ_FMD_ANSI_378_2004 = 0x001B0001;
    public const uint DPFJ_PROBABILITY_ONE = 0x7FFFFFFF;
    public const int MAX_FMD_SIZE = 1562 * 2;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public struct DPFPDD_HW_DESCR
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string vendor_name;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string product_name;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string serial_num;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DPFPDD_VER_INFO { public int major, minor, maintenance; }

    [StructLayout(LayoutKind.Sequential)]
    public struct DPFPDD_HW_VERSION { public DPFPDD_VER_INFO hw_ver, fw_ver; public ushort bcd_rev; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public struct DPFPDD_DEV_INFO
    {
        public uint size;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 1024)] public string name;
        public DPFPDD_HW_DESCR descr;
        public ushort vendor_id, product_id;
        public DPFPDD_HW_VERSION ver;
        public uint modality, technology;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DPFPDD_CAPTURE_PARAM { public uint size, image_fmt, image_proc, image_res; }

    [StructLayout(LayoutKind.Sequential)]
    public struct DPFPDD_IMAGE_INFO { public uint size, width, height, res, bpp; }

    [StructLayout(LayoutKind.Sequential)]
    public struct DPFPDD_CAPTURE_RESULT { public uint size; public int success; public uint quality, score; public DPFPDD_IMAGE_INFO info; }

    [StructLayout(LayoutKind.Sequential)]
    public struct DPFJ_CANDIDATE { public uint fmd_idx, view_idx; }

    [DllImport("dpfpdd")] public static extern int dpfpdd_init();
    [DllImport("dpfpdd")] public static extern int dpfpdd_exit();
    [DllImport("dpfpdd")] public static extern int dpfpdd_query_devices(ref uint dev_cnt, IntPtr dev_infos);
    [DllImport("dpfpdd", CharSet = CharSet.Ansi)] public static extern int dpfpdd_open(string dev_name, out IntPtr pdev);
    [DllImport("dpfpdd")] public static extern int dpfpdd_close(IntPtr dev);
    [DllImport("dpfpdd")]
    public static extern int dpfpdd_capture(IntPtr dev, ref DPFPDD_CAPTURE_PARAM capture_parm, uint timeout_cnt,
        ref DPFPDD_CAPTURE_RESULT capture_result, ref uint image_size, [Out] byte[] image_data);

    [DllImport("dpfj")]
    public static extern int dpfj_create_fmd_from_fid(uint fid_type, byte[] fid, uint fid_size, uint fmd_type, [Out] byte[] fmd, ref uint fmd_size);
    [DllImport("dpfj")]
    public static extern int dpfj_identify(uint fmd1_type, byte[] fmd1, uint fmd1_size, uint fmd1_view_idx,
        uint fmds_type, uint fmds_cnt, IntPtr[] fmds, uint[] fmds_sizes, uint threshold_score, ref uint candidate_cnt, [Out] DPFJ_CANDIDATE[] candidates);
    [DllImport("dpfj")] public static extern int dpfj_start_enrollment(uint fmd_type);
    [DllImport("dpfj")] public static extern int dpfj_add_to_enrollment(uint fmd_type, byte[] fmd, uint fmd_size, uint fmd_view_idx);
    [DllImport("dpfj")] public static extern int dpfj_create_enrollment_fmd([Out] byte[]? fmd, ref uint fmd_size);
    [DllImport("dpfj")] public static extern int dpfj_finish_enrollment();
}
