namespace Gymli.Checkin.Core.Access;

/// <summary>
/// Gymli business rules — the C# twin of apps/web/src/lib/access.ts.
/// Both run shared/test-vectors/access-rules.json. See CLAUDE.md §3.
/// </summary>
public static class AccessRules
{
    public static readonly TimeZoneInfo GymTimeZone = FindGymZone();

    private static TimeZoneInfo FindGymZone()
    {
        foreach (var id in new[] { "Africa/Johannesburg", "South Africa Standard Time" })
        {
            try { return TimeZoneInfo.FindSystemTimeZoneById(id); } catch (TimeZoneNotFoundException) { } catch (InvalidTimeZoneException) { }
        }
        // South Africa has no daylight saving: UTC+2 all year.
        return TimeZoneInfo.CreateCustomTimeZone("SAST", TimeSpan.FromHours(2), "SAST", "SAST");
    }

    /// <summary>Calendar date at the gym for an instant.</summary>
    public static DateOnly DateAtGym(DateTimeOffset instant) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, GymTimeZone).DateTime);

    /// <summary>Inclusive end date of a paid period.</summary>
    public static DateOnly PeriodEnd(PeriodKind kind, int qty, DateOnly start)
    {
        if (qty < 1) throw new ArgumentOutOfRangeException(nameof(qty), "Quantity must be 1 or more");
        return kind switch
        {
            PeriodKind.Day => start,
            PeriodKind.Days => start.AddDays(qty - 1),
            // DateOnly.AddMonths clamps to the end of the month (31 Jan + 1 → 28/29 Feb)
            PeriodKind.Months => start.AddMonths(qty).AddDays(-1),
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };
    }

    /// <summary>End of the continuous run of periods (overlapping or back-to-back) covering today, or null.</summary>
    public static DateOnly? PaidUntil(IEnumerable<PeriodDates> periods, DateOnly today)
    {
        var live = periods.Where(p => !p.Deleted).ToList();
        if (!live.Any(p => p.Start <= today && today <= p.End)) return null;
        var end = today;
        bool extended;
        do
        {
            extended = false;
            var next = end.AddDays(1);
            foreach (var p in live)
            {
                if (p.Start <= next && p.End > end)
                {
                    end = p.End;
                    extended = true;
                }
            }
        } while (extended);
        return end;
    }

    public static AccessDecision Evaluate(IEnumerable<PeriodDates> periods, DateOnly today)
    {
        var list = periods.ToList();
        var until = PaidUntil(list, today);
        if (until is { } u) return AccessDecision.Allow(u, u.DayNumber - today.DayNumber);

        var live = list.Where(p => !p.Deleted).ToList();
        var future = live.Where(p => p.Start > today).OrderBy(p => p.Start).FirstOrDefault();
        if (future is not null) return AccessDecision.Deny(DeniedReason.Starts, future.Start);

        var past = live.Where(p => p.End < today).OrderByDescending(p => p.End).FirstOrDefault();
        if (past is not null) return AccessDecision.Deny(DeniedReason.Ended, past.End);

        return AccessDecision.Deny(DeniedReason.None, null);
    }

    private static readonly string[] Months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    /// <summary>"8 Oct", or "9 Jan 2027" when the year differs from today's.</summary>
    public static string FormatSmart(DateOnly d, DateOnly today) =>
        d.Year == today.Year ? $"{d.Day} {Months[d.Month - 1]}" : $"{d.Day} {Months[d.Month - 1]} {d.Year}";

    /// <summary>Exact wording shown at the turnstile and in the door log.</summary>
    public static string DeniedText(DeniedReason reason, DateOnly? date, DateOnly today) => reason switch
    {
        DeniedReason.NotRecognised => "Fingerprint not recognised",
        DeniedReason.Ended => $"Membership ended {FormatSmart(date!.Value, today)}",
        DeniedReason.Starts => $"Paid period starts {FormatSmart(date!.Value, today)}",
        DeniedReason.None => "No paid membership",
        _ => "Please see reception",
    };

    public static string ReasonCode(DeniedReason r) => r switch
    {
        DeniedReason.NotRecognised => "not_recognised",
        DeniedReason.Ended => "ended",
        DeniedReason.Starts => "starts",
        _ => "none",
    };
}

public enum PeriodKind { Day, Days, Months }

public enum DeniedReason { NotRecognised, Ended, Starts, None }

public record PeriodDates(DateOnly Start, DateOnly End, bool Deleted = false);

public sealed record AccessDecision(bool Allowed, DateOnly? PaidUntil, int DaysLeft, DeniedReason? Reason, DateOnly? Date)
{
    public static AccessDecision Allow(DateOnly until, int daysLeft) => new(true, until, daysLeft, null, null);
    public static AccessDecision Deny(DeniedReason reason, DateOnly? date) => new(false, null, 0, reason, date);
}
