using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;

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
            desktop.MainWindow = window;
            window.ShowIdle();
            desktop.Exit += (_, _) => Host.Dispose();
        }
        base.OnFrameworkInitializationCompleted();
    }
}
