using Avalonia;
using Avalonia.Headless;
using Avalonia.Threading;
using Gymli.Checkin.Core.Engine;

namespace Gymli.Checkin.App;

/// <summary>Renders the kiosk states headless, for the side-by-side check against the design (05a–c).</summary>
public static class Screenshots
{
    public static void Render(string folder)
    {
        Directory.CreateDirectory(folder);
        AppBuilder.Configure<App>().UseSkia().UseHeadless(new AvaloniaHeadlessPlatformOptions { UseHeadlessDrawing = false }).SetupWithoutStarting();

        var w = new KioskWindow { Width = 1440, Height = 900 };
        w.Show();
        void Shot(string name, Action setup)
        {
            setup();
            Dispatcher.UIThread.RunJobs();
            var frame = w.CaptureRenderedFrame();
            frame?.Save(Path.Combine(folder, $"{name}.png"));
        }
        Shot("05a-idle", () => { w.ShowIdle(); w.SetOnline(true); });
        Shot("05b-welcome", () => w.Show(KioskView.Welcome, "KT", "Keabetswe Tau", "Paid until 31 Oct · 30 days left"));
        Shot("05c-denied", () => { w.Show(KioskView.Denied, "LM", "Membership ended 30 Sep", "Lerato Mokoena · Please see reception"); w.SetOnline(false); });
        Shot("enrol", () => { w.SetOnline(true); w.ShowEnrol(new EnrolProgress("Ntombi Cele", 1, 4, "Lift, then place the same finger again", false, false)); });
        Shot("idle-offline", () => { w.ShowEnrol(null); w.SetOnline(false); });
        w.Close();
    }
}
