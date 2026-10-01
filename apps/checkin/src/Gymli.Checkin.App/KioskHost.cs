using System.Text.Json;
using Gymli.Checkin.Core;
using Gymli.Checkin.Core.Engine;
using Gymli.Checkin.Core.Hardware;
using Gymli.Checkin.Core.Security;
using Gymli.Checkin.Core.Storage;
using Gymli.Checkin.Core.Sync;
using Gymli.Checkin.Hardware.DigitalPersona;
using Gymli.Checkin.Hardware.Simulated;
using Gymli.Checkin.Hardware.UsbRelay;

namespace Gymli.Checkin.App;

/// <summary>Builds and runs everything behind the kiosk screen.</summary>
public sealed class KioskHost : IDisposable
{
    public CheckinSettings Settings { get; }
    public LocalStore Store { get; }
    public IFingerprintReader Reader { get; }
    public ITurnstileRelay Relay { get; }
    public SyncService Sync { get; }
    public CheckinEngine Engine { get; }
    public int ClockOffsetDays { get; set; }
    public IClock Clock { get; }

    private readonly FirestoreClient _fs;
    public FirestoreClient Firestore => _fs;
    private readonly CancellationTokenSource _cts = new();

    public KioskHost(CheckinSettings settings)
    {
        Settings = settings;
        ClockOffsetDays = settings.ClockOffsetDays;
        Clock = new SystemClock(() => ClockOffsetDays);
        var protector = TemplateProtector.LoadOrCreate(settings.DataFolder);
        Store = new LocalStore(Path.Combine(settings.DataFolder, "gymli.db"), protector);

        if (settings.Simulation)
        {
            Reader = new SimulatedReader();
            Relay = new SimulatedRelay();
        }
        else
        {
            Reader = new DigitalPersonaReader();
            Relay = new SerialRelay(settings.RelayPort, settings.RelayChannel);
        }

        _fs = new FirestoreClient(settings);
        Sync = new SyncService(_fs, Store, settings, () => (Reader.IsConnected, Relay.IsConnected));
        Engine = new CheckinEngine(Reader, Relay, Store, Clock, settings, () => Sync.Online) { Sync = Sync };
        Sync.EnrolRequested += Engine.RequestEnrol;
    }

    public void Start()
    {
        Log.Info($"Gymli Check-in starting ({(Settings.Simulation ? "simulation" : "hardware")}), {Store.MemberCount} members saved locally");
        _ = Task.Run(async () =>
        {
            try { await Reader.StartAsync(_cts.Token); }
            catch (Exception ex) { Log.Error("Reader did not start", ex); }
        });
        _ = Task.Run(() => Forever("sync", () => Sync.RunAsync(_cts.Token)));
        _ = Task.Run(() => Forever("check-in", () => Engine.RunAsync(_cts.Token)));
    }

    /// <summary>Restarts a loop if it ever crashes, so the turnstile keeps working.</summary>
    private async Task Forever(string name, Func<Task> loop)
    {
        while (!_cts.IsCancellationRequested)
        {
            try
            {
                await loop();
            }
            catch (OperationCanceledException) when (_cts.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                Log.Error($"The {name} loop stopped; restarting in 2 s", ex);
                await Task.Delay(2000).ContinueWith(_ => { });
            }
        }
    }

    public static CheckinSettings LoadSettings()
    {
        var settings = new CheckinSettings();
        // Next to the exe first, then the machine-wide file (which wins, so updates keep the PC's settings)
        foreach (var path in new[] { Path.Combine(AppContext.BaseDirectory, "appsettings.json"), Path.Combine(CheckinSettings.DefaultDataFolder(), "appsettings.json") })
        {
            if (!File.Exists(path)) continue;
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(path), new JsonDocumentOptions { CommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true });
                var loaded = JsonSerializer.Deserialize<CheckinSettings>(doc.RootElement.GetRawText(), new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (loaded is not null)
                {
                    if (string.IsNullOrEmpty(loaded.DataFolder)) loaded.DataFolder = CheckinSettings.DefaultDataFolder();
                    settings = loaded;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Could not read {path}: {ex.Message}");
            }
        }
        foreach (var (key, apply) in new (string, Action<string>)[]
        {
            ("GYMLI_MODE", v => settings.Mode = v),
            ("GYMLI_EMULATOR_HOST", v => settings.EmulatorHost = v),
            ("GYMLI_PROJECT_ID", v => settings.FirebaseProjectId = v),
            ("GYMLI_API_KEY", v => settings.FirebaseApiKey = v),
            ("GYMLI_DEVICE_EMAIL", v => settings.DeviceEmail = v),
            ("GYMLI_DEVICE_PASSWORD", v => settings.DevicePassword = v),
            ("GYMLI_DATA", v => settings.DataFolder = v),
        })
        {
            if (Environment.GetEnvironmentVariable(key) is { Length: > 0 } v) apply(v);
        }
        return settings;
    }

    public void Dispose()
    {
        _cts.Cancel();
        Reader.Dispose();
        Relay.Dispose();
        Store.Dispose();
        _fs.Dispose();
    }
}
