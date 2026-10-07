using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Shapes;
using Avalonia.Input;
using Avalonia.Media;
using Avalonia.Threading;
using Gymli.Checkin.Core;
using Gymli.Checkin.Core.Engine;
using Gymli.Checkin.Hardware.Simulated;

namespace Gymli.Checkin.App;

public enum KioskView { Idle, Welcome, Denied, Enrol }

public partial class KioskWindow : Window
{
    private readonly KioskHost? _host;
    private readonly DispatcherTimer _tick;
    private DispatcherTimer? _resultTimer;
    private bool _enrolling;
    private bool _quitting;
    private readonly List<string> _simLog = new();

    // Designer / screenshot constructor
    public KioskWindow() : this(null) { }

    public KioskWindow(KioskHost? host)
    {
        _host = host;
        InitializeComponent();
        _tick = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _tick.Tick += (_, _) => Refresh();
        if (host is null) return;

        Place.Text = $"Reception · {host.Settings.DeviceName}";
        host.Engine.ScanCompleted += o => Dispatcher.UIThread.Post(() => ShowResult(o));
        host.Engine.EnrolChanged += p => Dispatcher.UIThread.Post(() => ShowEnrol(p));
        host.Engine.RelayPulsed += msg => Dispatcher.UIThread.Post(() => FlashPulse(msg));
        host.Sync.StatusChanged += () => Dispatcher.UIThread.Post(Refresh);
        Log.Written += line => Dispatcher.UIThread.Post(() => AddSimLog(line));

        if (host.Settings.Simulation) SetupSimulation(host);
        else if (host.Settings.KioskScreen)
        {
            // Kiosk: full screen, always on top, no window chrome
            WindowState = WindowState.FullScreen;
            Topmost = true;
            SystemDecorations = SystemDecorations.None;
            Cursor = new Cursor(StandardCursorType.None);
        }
        else
        {
            // Background: members only scan their finger. The window stays minimised on the
            // reception PC; staff can open it from the taskbar to see its status.
            Title = $"Body Tone Gym · Check-in · {host.Settings.DeviceName}";
            WindowState = WindowState.Minimized;
            // The X button minimises, so the turnstile keeps working. Ctrl+Shift+Q quits.
            Closing += (_, e) =>
            {
                if (_quitting || e.CloseReason != WindowCloseReason.WindowClosing) return;
                e.Cancel = true;
                WindowState = WindowState.Minimized;
            };
        }
        KeyDown += OnKey;
        _tick.Start();
        Refresh();
    }

    private void OnKey(object? sender, KeyEventArgs e)
    {
        // Staff only: Ctrl+Shift+Q closes the kiosk, F2 shows the simulation panel
        if (e.Key == Key.Q && e.KeyModifiers.HasFlag(KeyModifiers.Control) && e.KeyModifiers.HasFlag(KeyModifiers.Shift))
        {
            _quitting = true;
            Close();
        }
        if (e.Key == Key.F2 && _host?.Settings.Simulation == true) SimPanel.IsVisible = !SimPanel.IsVisible;
        if (e.Key == Key.F11) WindowState = WindowState == WindowState.FullScreen ? WindowState.Normal : WindowState.FullScreen;
    }

    /* ---------------- Status line, clock ---------------- */

    private void Refresh()
    {
        var now = _host?.Clock.Now ?? DateTimeOffset.Now;
        var local = TimeZoneInfo.ConvertTime(now, Core.Access.AccessRules.GymTimeZone);
        TimeText.Text = local.ToString("HH:mm");
        DateText.Text = local.ToString("ddd d MMM yyyy", System.Globalization.CultureInfo.GetCultureInfo("en-GB"));
        if (_host is null) return;
        SetOnline(_host.Sync.Online);
        if (_host.Settings.Simulation)
            ClockText.Text = _host.ClockOffsetDays == 0 ? $"Today {local:ddd d MMM}" : $"Pretending it is {local:ddd d MMM} ({_host.ClockOffsetDays:+0;-0} days)";
    }

    public void SetOnline(bool online)
    {
        StatusDot.IsVisible = online;
        StatusOfflineIcon.IsVisible = !online;
        StatusText.Text = online ? "Online · synced" : "Offline · using saved list";
        var onResult = BgResult.IsVisible;
        StatusPill.Background = Brush(online ? (onResult ? "GlassOnGreen" : "GlassKiosk") : "Yellow");
        StatusPill.BorderThickness = new Thickness(online && !onResult ? 1 : 0);
        StatusDot.Fill = Brush(onResult ? "Ink" : "GreenMark");
    }

    private IBrush Brush(string key) => (IBrush)Application.Current!.FindResource(key)!;

    /* ---------------- Views ---------------- */

    public void Show(KioskView view, string? initials = null, string? headline = null, string? detail = null)
    {
        var result = view is KioskView.Welcome or KioskView.Denied;
        IdleView.IsVisible = !result;
        ResultView.IsVisible = result;
        BgIdle.IsVisible = BgGlow.IsVisible = !result;
        BgResult.IsVisible = result;
        BgResult.Background = Brush(view == KioskView.Denied ? "Red" : "Green");
        ClockBlock.IsVisible = !result;
        Place.Foreground = Brush(result ? "Ink" : "Muted");
        LogoDot.Foreground = Brush(result ? "Ink" : "Brand");
        Place.FontFamily = (FontFamily)Application.Current!.FindResource(result ? "FontSemibold" : "FontText")!;

        // Arm state at the bottom
        var open = view == KioskView.Welcome;
        ArmCircle.Width = ArmCircle.Height = result ? 60 : 48;
        ArmIconBox.Width = ArmIconBox.Height = result ? 26 : 20;
        ArmIcon.Data = (Geometry)Application.Current!.FindResource(open ? "IconLockOpen" : "IconLock")!;
        ArmIcon.Stroke = Brush(view switch { KioskView.Welcome => "Green", KioskView.Denied => "Red", _ => "White" });
        ArmText.Text = open ? "Arm unlocked" : "Arm locked";
        ArmText.FontSize = result ? 24 : 18;
        ArmText.FontFamily = (FontFamily)Application.Current!.FindResource(result ? "FontStrong" : "FontSemibold")!;
        ArmHint.IsVisible = open;
        // Design: clock left + arm right when idle; arm alone, bottom left, on a result
        Grid.SetColumn(ArmBlock, result ? 0 : 1);
        ArmBlock.HorizontalAlignment = result ? Avalonia.Layout.HorizontalAlignment.Left : Avalonia.Layout.HorizontalAlignment.Right;

        if (result)
        {
            ResultWord.Text = open ? "WELCOME" : "DENIED";
            ResultInitials.Text = initials ?? "?";
            ResultInitials.Foreground = Brush(open ? "Green" : "Red");
            ResultHeadline.Text = headline ?? "";
            ResultDetail.Text = detail ?? "";
        }
        if (_host is not null) SetOnline(_host.Sync.Online);
    }

    private void ShowResult(ScanOutcome o)
    {
        if (_enrolling) return;
        Show(o.Allowed ? KioskView.Welcome : KioskView.Denied, o.Member?.Initials ?? "?", o.Headline, o.Detail);
        _resultTimer?.Stop();
        _resultTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(_host?.Settings.ResultSeconds ?? 4) };
        _resultTimer.Tick += (_, _) =>
        {
            _resultTimer?.Stop();
            if (!_enrolling) ShowIdle();
        };
        _resultTimer.Start();
    }

    public void ShowIdle()
    {
        Show(KioskView.Idle);
        IdleTitle.Text = "Place your finger on the scanner";
        IdleHint.Text = _host is { Reader.IsConnected: false } ? "Scanner not connected · please see reception" : "Hold still until the screen changes";
        EnrolRing.IsVisible = false;
        EnrolDots.IsVisible = false;
    }

    public void ShowEnrol(EnrolProgress? p)
    {
        _enrolling = p is not null && !p.Done && !p.Failed || p is { Done: true };
        if (p is null)
        {
            _enrolling = false;
            ShowIdle();
            return;
        }
        Show(KioskView.Enrol);
        IdleTitle.Text = p.Done ? "Fingerprint enrolled" : p.Failed ? "Try again" : $"Scan {Math.Min(p.Step + 1, p.Total)} of {p.Total}";
        IdleHint.Text = p.Done ? $"{p.MemberName} can use the turnstile once a payment is logged" : $"{p.MemberName} · {p.Message}";
        EnrolRing.IsVisible = true;
        EnrolRing.SweepAngle = 360.0 * (p.Done ? p.Total : p.Step) / p.Total;
        EnrolDots.IsVisible = true;
        EnrolDots.Children.Clear();
        for (var i = 0; i < p.Total; i++)
        {
            var done = p.Done || i < p.Step;
            EnrolDots.Children.Add(new Ellipse
            {
                Width = 18,
                Height = 18,
                Fill = Brush(done ? "Green" : i == p.Step ? "White" : "Step"),
                Stroke = !done && i == p.Step ? Brush("Ink") : null,
                StrokeThickness = 3,
            });
        }
    }

    private void FlashPulse(string msg)
    {
        AddSimLog(msg);
        if (_host?.Settings.Simulation != true) return;
        PulseText.Text = $"Relay pulse {_host.Settings.RelayPulseMs} ms";
        PulseFlash.IsVisible = true;
        DispatcherTimer.RunOnce(() => PulseFlash.IsVisible = false, TimeSpan.FromMilliseconds(Math.Max(800, _host.Settings.RelayPulseMs)));
    }

    /* ---------------- Simulation panel ---------------- */

    private void SetupSimulation(KioskHost host)
    {
        SimPanel.IsVisible = true;
        var reader = (SimulatedReader)host.Reader;
        void Fill()
        {
            var q = (SimSearch.Text ?? "").Trim().ToLowerInvariant();
            SimMembers.ItemsSource = host.Store.Members
                .Where(m => q.Length == 0 || m.Name.ToLowerInvariant().Contains(q) || m.Code.ToLowerInvariant().Contains(q) || m.Number.ToString().Contains(q))
                .OrderBy(m => m.FirstName)
                .Select(m => new ListBoxItem { Content = $"{m.Name} · {m.Code}{(m.FingerprintEnrolled ? "" : " · no fingerprint")}", Tag = m.Id, Foreground = Brush("White") })
                .ToList();
        }
        Fill();
        SimSearch.TextChanged += (_, _) => Fill();
        host.Sync.StatusChanged += () => Dispatcher.UIThread.Post(() => { if (SimMembers.ItemCount != host.Store.MemberCount && string.IsNullOrEmpty(SimSearch.Text)) Fill(); });
        SimMembers.SelectionChanged += (_, _) => { if (SimMembers.SelectedItem is ListBoxItem { Tag: string id }) { reader.PresentFinger(id); SimMembers.SelectedItem = null; } };
        UnknownFinger.Click += (_, _) => reader.PresentFinger(null);
        ReaderToggle.Click += (_, _) =>
        {
            reader.SetConnected(!reader.IsConnected);
            ReaderToggle.Content = reader.IsConnected ? "Unplug reader" : "Plug in reader";
            ShowIdle();
        };
        ClockPlus.Click += (_, _) => { host.ClockOffsetDays++; Refresh(); };
        ClockMinus.Click += (_, _) => { host.ClockOffsetDays--; Refresh(); };
        ClockReset.Click += (_, _) => { host.ClockOffsetDays = 0; Refresh(); };
    }

    private void AddSimLog(string line)
    {
        if (!SimPanel.IsVisible) return;
        _simLog.Insert(0, line.Length > 19 ? line[11..] : line);
        if (_simLog.Count > 40) _simLog.RemoveAt(_simLog.Count - 1);
        SimLog.Text = string.Join("\n", _simLog);
    }
}
