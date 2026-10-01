namespace Gymli.Checkin.Core;

/// <summary>Settings from appsettings.json next to the app (or %ProgramData%\Gymli\appsettings.json).</summary>
public sealed class CheckinSettings
{
    /// <summary>"simulation" or "hardware"</summary>
    public string Mode { get; set; } = "simulation";
    public bool Simulation => !string.Equals(Mode, "hardware", StringComparison.OrdinalIgnoreCase);

    public string DeviceName { get; set; } = "Turnstile 1";

    // Firebase project (public web config) and the check-in login made in Settings → Check-in PCs
    public string FirebaseApiKey { get; set; } = "AIzaSyA_7OZFBLLvcm61zSsJt-cBF74Oqe_Gf1E";
    public string FirebaseProjectId { get; set; } = "fundanii-ai";
    public string DeviceEmail { get; set; } = "";
    public string DevicePassword { get; set; } = "";
    /// <summary>For testing: "127.0.0.1" to use the Firebase emulator.</summary>
    public string? EmulatorHost { get; set; }

    public int SyncSeconds { get; set; } = 3;
    public int RelayPulseMs { get; set; } = 500;
    public int ResultSeconds { get; set; } = 4;

    /// <summary>Serial port of the USB relay board, e.g. "COM3". Empty = first CH340 port found.</summary>
    public string RelayPort { get; set; } = "";
    /// <summary>Relay channel (1-based) for multi-channel boards.</summary>
    public int RelayChannel { get; set; } = 1;

    /// <summary>For acceptance tests only: shifts "today" by this many days.</summary>
    public int ClockOffsetDays { get; set; }

    public string DataFolder { get; set; } = DefaultDataFolder();

    public static string DefaultDataFolder()
    {
        var root = OperatingSystem.IsWindows()
            ? Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData)
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "share");
        return Path.Combine(root, "Gymli");
    }
}
