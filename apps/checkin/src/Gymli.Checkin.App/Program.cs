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
/// </summary>
public static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        var settings = KioskHost.LoadSettings();
        Directory.CreateDirectory(settings.DataFolder);
        Log.Init(settings.DataFolder);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Log.Error("Unhandled error", e.ExceptionObject as Exception);
        TaskScheduler.UnobservedTaskException += (_, e) => { Log.Error("Background error", e.Exception); e.SetObserved(); };

        if (args.Length > 0 && args[0] == "--export-key")
        {
            TemplateProtector.LoadOrCreate(settings.DataFolder);
            Console.WriteLine(TemplateProtector.Export(settings.DataFolder));
            return 0;
        }
        if (args.Length > 1 && args[0] == "--import-key")
        {
            TemplateProtector.LoadOrCreate(settings.DataFolder, args[1]);
            Console.WriteLine("Key imported.");
            return 0;
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

    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>().UsePlatformDetect().LogToTrace();
}
