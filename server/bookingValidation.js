export function serviceDurationMinutes(duration) {
  const value=String(duration||"").trim().toLowerCase();
  const match=/^(\d{1,3})\s*(min|mins|minute|minutes|h|hr|hour|hours)$/.exec(value);
  if (!match) return null;
  const minutes=Number(match[1])*(["h","hr","hour","hours"].includes(match[2])?60:1);
  return minutes >= 15 && minutes <= 480 ? minutes : null;
}

export function businessLocalTime(date, timezone) {
  const parts=new Intl.DateTimeFormat("en-GB",{
    timeZone:timezone,weekday:"long",year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",hourCycle:"h23",
  }).formatToParts(date);
  const map=Object.fromEntries(parts.filter(part=>part.type!=="literal").map(p=>[p.type,p.value]));
  return {
    weekday:map.weekday,
    date:`${map.year}-${map.month}-${map.day}`,
    time:`${map.hour}:${map.minute}`,
  };
}
function asMinutes(value) {
  const match=/^(\d{1,2}):(\d{2})$/.exec(String(value||""));
  if (!match) return null;
  const hh=Number(match[1]),mm=Number(match[2]);
  return hh<24&&mm<60?hh*60+mm:null;
}
export function validateBookingWindow({startAt,durationMinutes,timezone,hoursJson,now=Date.now()}) {
  if (typeof startAt!=="string" || !/^\d{4}-\d{2}-\d{2}T/.test(startAt)) throw new Error("An ISO booking start time is required");
  const start=new Date(startAt);
  if (!Number.isFinite(start.getTime()) || !Number.isInteger(durationMinutes)
    || durationMinutes<15 || durationMinutes>480) throw new Error("Invalid appointment date or duration");
  if (start.getTime()<now+5*60_000 || start.getTime()>now+120*86_400_000) throw new Error("Booking time must be within the next 120 days");
  const end=new Date(start.getTime()+durationMinutes*60_000);
  let localStart,localEnd;
  try {
    localStart=businessLocalTime(start,timezone);
    localEnd=businessLocalTime(end,timezone);
  } catch { throw new Error("Business timezone is not configured correctly"); }
  if (localStart.date!==localEnd.date) throw new Error("Appointments spanning business-day boundaries require staff assistance");
  if (!Array.isArray(hoursJson) || !hoursJson.length) throw new Error("Business hours are not configured");
  const row=hoursJson.find(x=>String(x.day||"").toLowerCase()===localStart.weekday.toLowerCase());
  if (!row || row.closed) throw new Error("Business is closed at the requested time");
  const opens=asMinutes(row.open),closes=asMinutes(row.close);
  const from=asMinutes(localStart.time),to=asMinutes(localEnd.time);
  if (opens===null||closes===null||from<opens||to>closes||from>=to) {
    throw new Error("Requested appointment is outside business hours");
  }
  return {start:start.toISOString(),end:end.toISOString(),
    localDate:localStart.date,localTime:localStart.time,timezone};
}
