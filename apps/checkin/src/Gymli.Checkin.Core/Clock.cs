using Gymli.Checkin.Core.Access;

namespace Gymli.Checkin.Core;

public interface IClock
{
    DateTimeOffset Now { get; }
    DateOnly Today { get; }
}

/// <summary>System clock, with an optional day offset for acceptance tests ("move the clock past the end date").</summary>
public sealed class SystemClock(Func<int> offsetDays) : IClock
{
    public DateTimeOffset Now => DateTimeOffset.UtcNow.AddDays(offsetDays());
    public DateOnly Today => AccessRules.DateAtGym(Now);
}

public sealed class FixedClock(DateTimeOffset now) : IClock
{
    public DateTimeOffset Value { get; set; } = now;
    public DateTimeOffset Now => Value;
    public DateOnly Today => AccessRules.DateAtGym(Value);
}
