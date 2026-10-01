using Gymli.Checkin.Core;
using Gymli.Checkin.Hardware.Simulated;

namespace Gymli.Checkin.App;

/// <summary>
/// Runs the real check-in engine and sync without a window, driven from stdin.
/// Used by the end-to-end acceptance test (apps/web/tests/e2e). Simulation mode only.
///
///   scan 1007 | scan unknown | clock 31 | net off | net on | status | quit
/// Prints: READY, RESULT allowed|denied text, PULSE ms, ENROL step/total, STATUS …
/// </summary>
public static class Agent
{
    public static int Run(CheckinSettings settings)
    {
        settings.Mode = "simulation";
        using var host = new KioskHost(settings);
        var reader = (SimulatedReader)host.Reader;
        var relay = (SimulatedRelay)host.Relay;
        relay.Pulsed += ms => Out($"PULSE {ms}");
        host.Engine.ScanCompleted += o => Out($"RESULT {(o.Allowed ? "allowed" : "denied")} {o.Headline}");
        host.Engine.EnrolChanged += p => { if (p is not null) Out($"ENROL {(p.Done ? p.Total : p.Step)}/{p.Total}{(p.Done ? " done" : "")}{(p.Failed ? " failed" : "")}"); };
        host.Start();
        Out("READY");
        string? line;
        while ((line = Console.ReadLine()) is not null)
        {
            var parts = line.Trim().Split(' ', 2, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0) continue;
            switch (parts[0])
            {
                case "scan":
                    var arg = parts.ElementAtOrDefault(1) ?? "";
                    var m = int.TryParse(arg.Replace("GY-", ""), out var n) ? host.Store.Members.FirstOrDefault(x => x.Number == n) : null;
                    reader.PresentFinger(m?.Id);
                    break;
                case "clock":
                    host.ClockOffsetDays = int.Parse(parts[1]);
                    Out($"CLOCK {host.ClockOffsetDays}");
                    break;
                case "net":
                    host.Firestore.SimulateOffline = parts.ElementAtOrDefault(1) == "off";
                    Out($"NET {(host.Firestore.SimulateOffline ? "off" : "on")}");
                    break;
                case "status":
                    Out($"STATUS online={host.Sync.Online.ToString().ToLowerInvariant()} members={host.Store.MemberCount} pending={host.Store.PendingCount} templates={host.Store.Templates.Count}");
                    break;
                case "quit":
                    return 0;
            }
        }
        return 0;
    }

    private static readonly object Gate = new();
    private static void Out(string s)
    {
        lock (Gate) Console.WriteLine(s);
    }
}
