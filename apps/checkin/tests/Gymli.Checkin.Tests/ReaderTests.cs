using Gymli.Checkin.Core;
using Gymli.Checkin.Hardware.ZkTeco;

namespace Gymli.Checkin.Tests;

/// <summary>Reader choice and the parts of the ZKTeco reader that do not need the device.</summary>
public class ReaderTests
{
    [Theory]
    [InlineData("simulation", "zkteco", "simulated")]
    [InlineData("hardware", "zkteco", "zkfinger-10")]
    [InlineData("hardware", "ZKTeco", "zkfinger-10")]
    [InlineData("hardware", "digitalpersona", "ansi-378-2004")]
    [InlineData("hardware", "DigitalPersona", "ansi-378-2004")]
    public void Template_format_follows_the_reader(string mode, string reader, string format)
    {
        Assert.Equal(format, new CheckinSettings { Mode = mode, Reader = reader }.TemplateFormat);
    }

    [Fact]
    public void ZKTeco_is_the_default_reader()
    {
        Assert.Equal("zkfinger-10", new CheckinSettings { Mode = "hardware" }.TemplateFormat);
    }

    // Scans are letters; scans with the same letter are the same finger.
    private static string? Pick(string scans) =>
        ZkTecoReader.PickMatchingScans(scans.ToCharArray(), (a, b) => a == b) is { } p ? new string(p.ToArray()) : null;

    [Theory]
    [InlineData("AAAA", "AAA")]  // newest three
    [InlineData("AAA", "AAA")]
    [InlineData("AA", null)]     // too few
    [InlineData("ABAA", "AAA")]  // one poor scan in between is skipped
    [InlineData("AAAB", "AAA")]  // a last scan with another finger is skipped
    [InlineData("ABCD", null)]   // nothing matches
    [InlineData("AABB", null)]
    [InlineData("AABBB", "BBB")]
    public void ZKTeco_enrolment_uses_three_matching_scans(string scans, string? expected)
    {
        Assert.Equal(expected, Pick(scans));
    }

    [Fact]
    public void ZKTeco_enrolment_picks_the_newest_matching_scans()
    {
        var scans = new[] { 1, 2, 3, 4, 5 };
        var p = ZkTecoReader.PickMatchingScans(scans, (_, _) => true);
        Assert.Equal(new[] { 3, 4, 5 }, p);
    }
}
