using Gymli.Checkin.Core;
using Gymli.Checkin.Hardware.UsbRelay;
using Xunit;

namespace Gymli.Checkin.Tests;

/// <summary>The bytes sent to the two kinds of USB relay board.</summary>
public class RelayTests
{
    [Fact]
    public void Serial_lcus_frames()
    {
        Assert.Equal(new byte[] { 0xA0, 0x01, 0x01, 0xA2 }, SerialRelay.Frame(1, true));
        Assert.Equal(new byte[] { 0xA0, 0x01, 0x00, 0xA1 }, SerialRelay.Frame(1, false));
        Assert.Equal(new byte[] { 0xA0, 0x02, 0x01, 0xA3 }, SerialRelay.Frame(2, true));
    }

    [Fact]
    public void Hid_usbrelay_frames()
    {
        Assert.Equal(new byte[] { 0x00, 0xFF, 0x01, 0, 0, 0, 0, 0, 0 }, HidRelay.Frame(1, true));
        Assert.Equal(new byte[] { 0x00, 0xFD, 0x01, 0, 0, 0, 0, 0, 0 }, HidRelay.Frame(1, false));
        Assert.Equal(new byte[] { 0x00, 0xFF, 0x02, 0, 0, 0, 0, 0, 0 }, HidRelay.Frame(2, true));
    }

    [Theory]
    [InlineData("serial", typeof(SerialRelay))]
    [InlineData("hid", typeof(HidRelay))]
    [InlineData("auto", typeof(SerialRelay))] // no HID relay plugged in on a build machine
    public void Factory_picks_the_board(string type, Type expected)
    {
        using var relay = RelayFactory.Create(new CheckinSettings { RelayType = type });
        Assert.IsType(expected, relay);
    }
}
