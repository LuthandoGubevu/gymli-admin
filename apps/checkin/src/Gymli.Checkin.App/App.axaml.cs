using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using Avalonia.Platform;
using Avalonia.Threading;

namespace Gymli.Checkin.App;

public partial class App : Application
{
    public static KioskHost? Host { get; set; }

    public override void Initialize() => AvaloniaXamlLoader.Load(this);

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop && Host is not null)
        {
            var window = new KioskWindow(Host);
            window.ShowIdle();
            desktop.Exit += (_, _) => Host.Dispose();
            if (Host.Settings.Simulation || Host.Settings.KioskScreen)
            {
                desktop.MainWindow = window;
            }
            else
            {
                // Background: no window at start, an icon next to the clock, and only Ctrl+Shift+Q
                // in the status window ends the program (the watchdog starts it again anyway).
                desktop.ShutdownMode = ShutdownMode.OnExplicitShutdown;
                ShowTrayIcon(Host, window);
            }
        }
        base.OnFrameworkInitializationCompleted();
    }

    private void ShowTrayIcon(KioskHost host, KioskWindow window)
    {
        void Open()
        {
            window.Show();
            window.WindowState = WindowState.Normal;
            window.Activate();
        }
        var open = new NativeMenuItem("Show status");
        open.Click += (_, _) => Open();
        var tray = new TrayIcon
        {
            Icon = new WindowIcon(AssetLoader.Open(new Uri("avares://Gymli.Checkin/Assets/gymli.ico"))),
            ToolTipText = "Body Tone Gym check-in",
            Menu = new NativeMenu { Items = { open } },
        };
        tray.Clicked += (_, _) => Open();
        TrayIcon.SetIcons(this, new TrayIcons { tray });

        // Status on hover, e.g. "Body Tone Gym check-in · online · scanner ✓ · gate ✓"
        var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
        timer.Tick += (_, _) => tray.ToolTipText =
            $"Body Tone Gym check-in · {(host.Sync.Online ? "online" : "offline")} · scanner {(host.Reader.IsConnected ? "✓" : "✗")} · gate {(host.Relay.IsConnected ? "✓" : "✗")}";
        timer.Start();
    }
}
