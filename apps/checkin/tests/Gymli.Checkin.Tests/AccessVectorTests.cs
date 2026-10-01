using System.Text.Json;
using Gymli.Checkin.Core.Access;
using Xunit;

namespace Gymli.Checkin.Tests;

/// <summary>Runs shared/test-vectors/access-rules.json — the same cases as the web app.</summary>
public class AccessVectorTests
{
    private static readonly JsonElement Vectors = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "access-rules.json"))).RootElement;

    private static IEnumerable<object[]> Cases(string group) =>
        Vectors.GetProperty(group).EnumerateArray().Select(v => new object[] { v.GetProperty("name").GetString()!, v.GetRawText() });

    public static IEnumerable<object[]> PeriodEndCases => Cases("periodEnd");
    public static IEnumerable<object[]> AccessCases => Cases("access");
    public static IEnumerable<object[]> DefaultStartCases => Cases("defaultStart");
    public static IEnumerable<object[]> GymDateCases => Cases("gymDate");

    private static List<PeriodDates> Periods(JsonElement v) =>
        v.GetProperty("periods").EnumerateArray().Select(p =>
        {
            var a = p.EnumerateArray().Select(x => x.GetString()!).ToArray();
            return new PeriodDates(DateOnly.Parse(a[0]), DateOnly.Parse(a[1]), a.Length > 2 && a[2] == "deleted");
        }).ToList();

    [Theory, MemberData(nameof(PeriodEndCases))]
    public void PeriodEnd(string name, string json)
    {
        var v = JsonDocument.Parse(json).RootElement;
        var kind = v.GetProperty("kind").GetString() switch { "day" => PeriodKind.Day, "days" => PeriodKind.Days, _ => PeriodKind.Months };
        var end = AccessRules.PeriodEnd(kind, v.GetProperty("qty").GetInt32(), DateOnly.Parse(v.GetProperty("start").GetString()!));
        Assert.True(end == DateOnly.Parse(v.GetProperty("end").GetString()!), $"{name}: got {end:yyyy-MM-dd}");
    }

    [Theory, MemberData(nameof(AccessCases))]
    public void Evaluate(string name, string json)
    {
        var v = JsonDocument.Parse(json).RootElement;
        var today = DateOnly.Parse(v.GetProperty("today").GetString()!);
        var d = AccessRules.Evaluate(Periods(v), today);
        Assert.True(d.Allowed == v.GetProperty("allowed").GetBoolean(), name);
        if (d.Allowed)
        {
            Assert.Equal(DateOnly.Parse(v.GetProperty("paidUntil").GetString()!), d.PaidUntil);
            Assert.Equal(v.GetProperty("daysLeft").GetInt32(), d.DaysLeft);
        }
        else
        {
            Assert.Equal(v.GetProperty("reason").GetString(), AccessRules.ReasonCode(d.Reason!.Value));
            var date = v.GetProperty("date");
            Assert.Equal(date.ValueKind == JsonValueKind.Null ? null : DateOnly.Parse(date.GetString()!), d.Date);
            Assert.Equal(v.GetProperty("text").GetString(), AccessRules.DeniedText(d.Reason!.Value, d.Date, today));
        }
    }

    [Theory, MemberData(nameof(DefaultStartCases))]
    public void DefaultStart(string name, string json)
    {
        var v = JsonDocument.Parse(json).RootElement;
        var today = DateOnly.Parse(v.GetProperty("today").GetString()!);
        var until = AccessRules.PaidUntil(Periods(v), today);
        var start = until?.AddDays(1) ?? today;
        Assert.True(start == DateOnly.Parse(v.GetProperty("start").GetString()!), name);
    }

    [Theory, MemberData(nameof(GymDateCases))]
    public void GymDate(string name, string json)
    {
        var v = JsonDocument.Parse(json).RootElement;
        var d = AccessRules.DateAtGym(DateTimeOffset.Parse(v.GetProperty("instantUtc").GetString()!));
        Assert.True(d == DateOnly.Parse(v.GetProperty("date").GetString()!), name);
    }

    [Fact]
    public void NotRecognisedText() => Assert.Equal("Fingerprint not recognised", AccessRules.DeniedText(DeniedReason.NotRecognised, null, new DateOnly(2026, 10, 1)));
}
