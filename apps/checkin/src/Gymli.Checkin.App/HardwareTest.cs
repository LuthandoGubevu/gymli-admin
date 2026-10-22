using System.Diagnostics;
using System.IO.Ports;
using System.Runtime.InteropServices;
using System.Text;
using Gymli.Checkin.Core;
using Gymli.Checkin.Core.Engine;
using Gymli.Checkin.Core.Hardware;
using Gymli.Checkin.Hardware.DigitalPersona;
using Gymli.Checkin.Hardware.UsbRelay;
using Gymli.Checkin.Hardware.ZkTeco;

namespace Gymli.Checkin.App;

/// <summary>
/// On-site hardware check (Gymli.Checkin.exe --hardware-test, or "Hardware test.bat").
/// Walks through: the PC, the fingerprint software (ZKTeco or DigitalPersona), the reader (enrol + match + speed),
/// the USB devices plugged in, and a test pulse on every possible relay. Nothing is sent
/// to the cloud and no fingerprints are kept. Writes a report to the desktop.
/// </summary>
public static class HardwareTest
{
    private static readonly StringBuilder Report = new();

    public static int Run(CheckinSettings settings)
    {
        if (OperatingSystem.IsWindows()) AllocConsole();
        Console.OutputEncoding = Encoding.UTF8;
        Line("Gymli Check-in · hardware test");
        Line($"{DateTime.Now:yyyy-MM-dd HH:mm} · app {typeof(HardwareTest).Assembly.GetName().Version?.ToString(3)}");
        Line(new string('=', 60));

        if (Mutex.TryOpenExisting("Global\\GymliCheckin", out _))
        {
            Line("Gymli Check-in is running. Close it first (Ctrl+Shift+Q), then run this test again.");
            return Finish(settings);
        }
        Line("Close any other fingerprint or gate program first (for example the current gym system),");
        Line("otherwise the reader and the gate box may be busy.");
        Ask("Press Enter to start");

        Step("1. This PC");
        Line($"Windows: {RuntimeInformation.OSDescription} · {(Environment.Is64BitOperatingSystem ? "64-bit" : "32-bit")}");
        Line($"Computer: {Environment.MachineName} · {Environment.ProcessorCount} cores · {GC.GetGCMemoryInfo().TotalAvailableMemoryBytes / 1_073_741_824.0:0.0} GB memory");

        foreach (var e in KioskHost.SettingsErrors) Line($"✗ Settings: {e}");

        Step("2. Fingerprint software");
        Line("ZKTeco (ZK9500 and other ZKTeco readers):");
        var zkOk = CheckDll("libzkfp");
        if (!zkOk && OperatingSystem.IsWindows() && File.Exists(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "SysWOW64", "libzkfp.dll")))
            Line("  Only the 32-bit libzkfp.dll is installed. Copy the 64-bit (x64) libzkfp.dll from the SDK's \"c\" folder into the GymliCheckin folder.");
        Line("HID DigitalPersona (U.are.U 4500):");
        var dpOk = CheckDll("dpfpdd") & CheckDll("dpfj");
        // Test the reader the settings ask for when its software is there; otherwise whichever is installed.
        var useDp = dpOk && (settings.DigitalPersona || !zkOk);
        if (zkOk || dpOk)
        {
            Line($"→ Testing the {(useDp ? "DigitalPersona" : "ZKTeco")} reader.");
            if (useDp != settings.DigitalPersona)
                Line($"  Note: appsettings.json says \"Reader\": \"{settings.Reader}\". For this reader use \"Reader\": \"{(useDp ? "digitalpersona" : "zkteco")}\".");
            ReaderTest(useDp ? new DigitalPersonaReader() : new ZkTecoReader());
        }
        else
        {
            Line("→ No fingerprint software. For a ZKTeco reader: run setup.exe from ZKTeco's ZKFinger SDK");
            Line("  (Fingerprint Reader Standard Driver), then run this test again.");
            Line("Skipping the reader test.");
        }

        Step("4. USB devices plugged in");
        ListUsb();

        Step("5. Gate (relay) test");
        RelayTest(settings);

        return Finish(settings);
    }

    /* ---------------- Reader ---------------- */

    private static void ReaderTest(IFingerprintReader reader)
    {
        Step("3. Fingerprint reader");
        using var _ = reader;
        try
        {
            reader.StartAsync(CancellationToken.None).GetAwaiter().GetResult();
            for (var i = 0; i < 15 && !reader.IsConnected; i++) Thread.Sleep(1000);
            if (!reader.IsConnected)
            {
                Line("✗ No reader found. Check the USB cable (the reader's light should be on), that no other program is using it,");
                Line("  and that the software above matches the reader (a ZKTeco driver does not run an HID reader, and the other way round).");
                return;
            }
            Line($"✓ Reader connected: {reader.Name}");

            Line("Enrol: place the SAME finger 4 times (lift it between scans). The reader may ask for up to 4 more.");
            var samples = new List<FingerSample>();
            byte[]? template = null;
            for (var i = 1; i <= CheckinEngine.MaxEnrolScans && template is null; i++)
            {
                Console.Write(i <= CheckinEngine.EnrolScans ? $"  Scan {i} of {CheckinEngine.EnrolScans}: place the finger… " : $"  Extra scan {i}: place the same finger again… ");
                var s = Capture(reader);
                if (s is null) { Line("✗ no scan within 30 seconds"); return; }
                samples.Add(s);
                Line($"✓ ({s.Fmd.Length} bytes)");
                if (i >= CheckinEngine.EnrolScans) template = reader.CreateTemplate(samples);
            }
            if (template is null) { Line($"✗ {samples.Count} scans did not make a template. Run the test again with a clean, dry finger."); return; }
            Line($"Enrolment took {samples.Count} scans");
            Line($"✓ Template made ({template.Length} bytes)");

            Console.Write("Match: place the SAME finger again… ");
            var same = Capture(reader);
            var mine = new[] { new StoredTemplate("test", template) };
            Line(same is null ? "✗ no scan" : reader.Identify(same, mine) == "test" ? "✓ recognised" : "✗ NOT recognised");

            Console.Write("Reject: place a DIFFERENT finger… ");
            var other = Capture(reader);
            Line(other is null ? "✗ no scan" : reader.Identify(other, mine) is null ? "✓ correctly not recognised" : "✗ wrongly recognised");

            if (same is not null)
            {
                var many = Enumerable.Range(0, 2000).Select(i => new StoredTemplate(i == 1999 ? "test" : $"m{i}", template)).ToList();
                var sw = Stopwatch.StartNew();
                reader.Identify(same, many);
                var first = sw.ElapsedMilliseconds;
                sw.Restart();
                reader.Identify(same, many);
                Line($"Speed: search of 2,000 members took {first} ms the first time, {sw.ElapsedMilliseconds} ms after that");
            }
        }
        catch (Exception ex)
        {
            Line($"✗ Reader error: {ex.GetType().Name}: {ex.Message}");
        }
    }

    private static FingerSample? Capture(IFingerprintReader reader)
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        try { return reader.CaptureAsync(cts.Token).GetAwaiter().GetResult(); }
        catch (OperationCanceledException) { return null; }
    }

    private static bool CheckDll(string name)
    {
        if (!NativeLibrary.TryLoad(name, typeof(HardwareTest).Assembly, null, out var handle))
        {
            Line($"✗ {name}.dll not found");
            return false;
        }
        NativeLibrary.Free(handle);
        var where = new[] { AppContext.BaseDirectory, Environment.SystemDirectory }
            .Concat((Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
            .Select(d => Path.Combine(d, name + ".dll"))
            .FirstOrDefault(File.Exists);
        Line($"✓ {name}.dll found{(where is null ? "" : $" ({where})")}");
        return true;
    }

    /* ---------------- USB ---------------- */

    private static void ListUsb()
    {
        var ports = SerialPorts.List();
        Line($"Serial (COM) ports: {(ports.Count > 0 ? string.Join(", ", ports.Select(p => p.Name + (p.Bluetooth ? " (Bluetooth)" : p.Ch340 ? " (CH340 relay)" : ""))) : "none")}");
        try
        {
            var hid = HidRelay.Find();
            Line(hid.Count == 0 ? "HID USB relay boards: none" : $"HID USB relay boards: {string.Join(", ", hid.Select(d => d.DevicePath))}");
        }
        catch (Exception ex) { Line($"HID relay search failed: {ex.Message}"); }

        if (!OperatingSystem.IsWindows()) return;
        var ps = "Get-PnpDevice -PresentOnly | Where-Object { $_.Class -in 'Ports','HIDClass','Biometric','USB','Multifunction' -or $_.InstanceId -like 'USB*' } | " +
                 "Sort-Object Class | Format-Table -AutoSize Class,Status,FriendlyName,InstanceId | Out-String -Width 220";
        try
        {
            var p = Process.Start(new ProcessStartInfo("powershell.exe", $"-NoProfile -Command \"{ps}\"") { RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true })!;
            var output = p.StandardOutput.ReadToEnd();
            p.WaitForExit(20_000);
            Line("USB devices (Device Manager):");
            Line(output.TrimEnd());
        }
        catch (Exception ex) { Line($"Could not list devices: {ex.Message}"); }
    }

    /* ---------------- Relay ---------------- */

    private static void RelayTest(CheckinSettings settings)
    {
        Line("Stand where you can see and hear the gate. Each test sends one 0.5 second pulse.");
        var candidates = new List<(string Label, Func<ITurnstileRelay> Make)>();
        try
        {
            foreach (var d in HidRelay.Find())
                foreach (var ch in new[] { 1, 2 })
                    candidates.Add(($"HID relay {HidRelaySafe(d)} channel {ch}", () => new HidRelay(ch, d.DevicePath)));
        }
        catch { }
        foreach (var port in SerialPorts.List())
        {
            if (port.Bluetooth) { Line($"  {port.Name} is a Bluetooth port, not a relay: skipped"); continue; }
            var name = port.Name;
            candidates.Add(($"Serial relay on {name} ({(port.Ch340 ? "CH340 relay board" : "unknown USB serial device")}, LCUS protocol)", () => new SerialRelay(name, settings.RelayChannel)));
        }

        if (candidates.Count == 0)
        {
            Line("✗ No relay found: no HID relay and no COM port. The gate box may use its own protocol — we will need its make and model.");
            return;
        }
        foreach (var (label, make) in candidates)
        {
            if (!YesNo($"Send a test pulse to: {label}?")) { Line($"  skipped: {label}"); continue; }
            try
            {
                using var relay = make();
                if (!relay.IsConnected) { Line($"✗ {label}: could not open (busy, or not a relay)"); continue; }
                relay.PulseAsync(settings.RelayPulseMs, CancellationToken.None).GetAwaiter().GetResult();
                var worked = YesNo("  Did the gate click or unlock?");
                Line($"{(worked ? "✓ GATE OPENED" : "✗ no reaction")}: {label}");
                if (worked)
                {
                    Line($"→ Use this in appsettings.json: {(label.StartsWith("HID") ? "\"RelayType\": \"hid\"" : $"\"RelayType\": \"serial\", \"RelayPort\": \"{label.Split(' ')[3]}\"")}");
                    break;
                }
            }
            catch (Exception ex)
            {
                Line($"✗ {label}: {ex.Message}");
            }
        }
    }

    private static string HidRelaySafe(HidSharp.HidDevice d)
    {
        try { return d.GetProductName(); } catch { return "board"; }
    }

    /* ---------------- Output ---------------- */

    private static int Finish(CheckinSettings settings)
    {
        Line(new string('=', 60));
        var name = $"gymli-hardware-test-{DateTime.Now:yyyyMMdd-HHmm}.txt";
        foreach (var folder in new[] { Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), settings.DataFolder })
        {
            try
            {
                if (string.IsNullOrEmpty(folder)) continue;
                Directory.CreateDirectory(folder);
                File.WriteAllText(Path.Combine(folder, name), Report.ToString());
                Line($"Report saved: {Path.Combine(folder, name)}");
            }
            catch { }
        }
        Ask("Done. Send the report file to Apex Dev Studios. Press Enter to close");
        return 0;
    }

    private static void Step(string title)
    {
        Line("");
        Line(title);
        Line(new string('-', title.Length));
    }

    private static void Line(string text)
    {
        Console.WriteLine(text);
        Report.AppendLine(text);
    }

    private static void Ask(string prompt)
    {
        Console.Write($"{prompt}… ");
        Console.ReadLine();
    }

    private static bool YesNo(string question)
    {
        while (true)
        {
            Console.Write($"{question} (y/n) ");
            var a = (Console.ReadLine() ?? "").Trim().ToLowerInvariant();
            if (a is "y" or "yes") { Report.AppendLine($"{question} yes"); return true; }
            if (a is "n" or "no" or "") { Report.AppendLine($"{question} no"); return false; }
        }
    }

    [DllImport("kernel32.dll")]
    private static extern bool AllocConsole();
}
