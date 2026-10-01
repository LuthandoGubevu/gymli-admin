using Gymli.Checkin.Core.Access;

namespace Gymli.Checkin.Core;

/// <summary>A member as kept in the local SQLite copy.</summary>
public sealed record LocalMember(
    string Id,
    int Number,
    string FirstName,
    string LastName,
    IReadOnlyList<PeriodDates> Periods,
    bool FingerprintEnrolled,
    long FingerprintEnrolledAt,
    bool Deleted)
{
    public string Name => $"{FirstName} {LastName}".Trim();
    public string Code => $"GY-{Number}";
    public string Initials
    {
        get
        {
            var parts = Name.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0) return "?";
            return parts.Length == 1 ? parts[0][..1].ToUpperInvariant() : $"{char.ToUpperInvariant(parts[0][0])}{char.ToUpperInvariant(parts[^1][0])}";
        }
    }
}

/// <summary>A decrypted fingerprint template (FMD) — kept in memory only.</summary>
public sealed record StoredTemplate(string MemberId, byte[] Fmd);

/// <summary>One scan at the turnstile, queued until uploaded.</summary>
public sealed record DoorLogEntry(
    string Id,
    string? MemberId,
    string? MemberName,
    int? MemberNumber,
    bool Allowed,
    string? Reason,
    string Text,
    string? PaidUntil,
    long AtMs,
    string Date,
    bool Offline);

/// <summary>What the kiosk shows after a scan.</summary>
public sealed record ScanOutcome(bool Allowed, LocalMember? Member, string Headline, string Detail, DoorLogEntry Log);
