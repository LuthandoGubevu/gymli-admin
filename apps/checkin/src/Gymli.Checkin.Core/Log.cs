namespace Gymli.Checkin.Core;

/// <summary>
/// Small daily file log (logs\gymli-YYYY-MM-DD.log). Never write fingerprint data,
/// full cellphone numbers or passwords here.
/// </summary>
public static class Log
{
    private static readonly object Gate = new();
    private static string? _folder;
    public static event Action<string>? Written;

    public static void Init(string dataFolder)
    {
        _folder = Path.Combine(dataFolder, "logs");
        Directory.CreateDirectory(_folder);
        // keep 30 days
        foreach (var f in Directory.GetFiles(_folder, "gymli-*.log"))
            if (File.GetLastWriteTimeUtc(f) < DateTime.UtcNow.AddDays(-30)) File.Delete(f);
    }

    public static void Info(string msg) => Write("INFO", msg);
    public static void Warn(string msg) => Write("WARN", msg);
    public static void Error(string msg, Exception? ex = null) => Write("ERROR", ex is null ? msg : $"{msg}: {ex.GetType().Name}: {ex.Message}\n{ex.StackTrace}");

    private static void Write(string level, string msg)
    {
        var line = $"{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss.fff} {level} {msg}";
        Written?.Invoke(line);
        if (_folder is null) return;
        try
        {
            lock (Gate) File.AppendAllText(Path.Combine(_folder, $"gymli-{DateTime.Now:yyyy-MM-dd}.log"), line + Environment.NewLine);
        }
        catch
        {
            // logging must never stop the turnstile
        }
    }
}
