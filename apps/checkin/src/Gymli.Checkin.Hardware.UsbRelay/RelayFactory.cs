using Gymli.Checkin.Core;
using Gymli.Checkin.Core.Hardware;

namespace Gymli.Checkin.Hardware.UsbRelay;

public static class RelayFactory
{
    /// <summary>The relay board from settings ("auto" picks a HID board if one is plugged in, else serial).</summary>
    public static ITurnstileRelay Create(CheckinSettings settings)
    {
        var type = settings.RelayType.Trim().ToLowerInvariant();
        if (type == "hid") return new HidRelay(settings.RelayChannel);
        if (type == "serial") return new SerialRelay(settings.RelayPort, settings.RelayChannel);
        bool hidFound;
        try { hidFound = HidRelay.Find().Count > 0; } catch { hidFound = false; }
        Log.Info(hidFound ? "Relay: HID USB relay found" : "Relay: no HID relay found, using serial (CH340)");
        return hidFound ? new HidRelay(settings.RelayChannel) : new SerialRelay(settings.RelayPort, settings.RelayChannel);
    }
}
