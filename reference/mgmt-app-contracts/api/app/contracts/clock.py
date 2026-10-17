from datetime import date, datetime, timedelta, timezone

VN = timezone(timedelta(hours=7))   # Vietnam has no daylight saving


def today_vn(now: datetime | None = None) -> date:
    return (now or datetime.now(timezone.utc)).astimezone(VN).date()
