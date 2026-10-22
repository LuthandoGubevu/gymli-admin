using Avalonia;
using Gymli.Checkin.Core;
using Gymli.Checkin.Core.Security;

namespace Gymli.Checkin.App;

/// <summary>
/// Gymli Check-in — full-screen kiosk at the turnstile.
///
///   Gymli.Checkin.exe                     run the kiosk
///   Gymli.Checkin.exe --export-key        print the fingerprint template key (store it safely)
///   Gymli.Checkin.exe --import-key KEY    use a backed-up key on a new PC
///   Gymli.Checkin.exe --screenshots DIR   render the kiosk screens to PNG (visual check)
///   Gymli.Checkin.exe --agent             no window; simulated scans from stdin (end-to-end tests)
///   Gymli.Checkin.exe --hardware-test     on-site check of the reader and the gate relay (report on the desktop)
/// </summary>
public static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        var settings = KioskHost.LoadSettings();
        Directory.CreateDirectory(settings.DataFolder);
        Log.Init(settings.DataFolder);
        foreach (var e in KioskHost.SettingsErrors) Log.Error(e);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Log.Error("Unhandled error", e.ExceptionObject as Exception);
        TaskScheduler.UnobservedTaskException += (_, e) => { Log.Error("Background error", e.Exception); e.SetObserved(); };

        if (args.Length > 0 && args[0] == "--export-key")
        {
            var own = UseConsole();
            TemplateProtector.LoadOrCreate(settings.DataFolder);
            Console.WriteLine("Fingerprint key (store it safely, e.g. in the manager's password manager):");
            Console.WriteLine(TemplateProtector.Export(settings.DataFolder));
            if (own) { Console.Write("Press Enter to close… "); Console.ReadLine(); }
            return 0;
        }
        if (args.Length > 1 && args[0] == "--import-key")
        {
            var own = UseConsole();
            TemplateProtector.LoadOrCreate(settings.DataFolder, args[1]);
            Console.WriteLine("Key imported.");
            if (own) { Console.Write("Press Enter to close… "); Console.ReadLine(); }
            return 0;
        }
        if (args.Length > 0 && args[0] == "--hardware-test")
        {
            return HardwareTest.Run(settings);
        }
        if (args.Length > 0 && args[0] == "--agent")
        {
            return Agent.Run(settings);
        }
        if (args.Length > 1 && args[0] == "--screenshots")
        {
            Screenshots.Render(args[1]);
            return 0;
        }

        // Only one kiosk at a time on this PC
        using var single = new Mutex(true, "Global\\GymliCheckin", out var first);
        if (!first)
        {
            Log.Warn("Gymli Check-in is already running");
            return 1;
        }

        App.Host = new KioskHost(settings);
        App.Host.Start();
        return BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }

    /// <summary>
    /// Gymli is a window app, so text written to the console is lost. Attach to the PowerShell/cmd
    /// window it was started from, or open a console of its own. Returns true when it opened its own.
    /// </summary>
    private static bool UseConsole()
    {
        if (!OperatingSystem.IsWindows()) return false;
        if (AttachConsole(-1)) { Console.WriteLine(); return false; }
        AllocConsole();
        return true;
    }

    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    private static extern bool AttachConsole(int processId);

    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    private static extern bool AllocConsole();

    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>().UsePlatformDetect().LogToTrace();
}
