import { findBridges, vacationOn, isSchoolDay } from "../js/vacations.js";
let fail = 0, pass = 0;
const ok = (c, msg) => { if(c) pass++; else { fail++; console.log("FAIL", msg); } };
const D = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y,m-1,d); };

ok(vacationOn("2026-12-08")?.name === "חנוכה", "hanukkah");
ok(!isSchoolDay(D("2026-10-27")), "election day off");
ok(isSchoolDay(D("2026-10-26")), "monday before election is a school day");
ok(!isSchoolDay(D("2026-10-17")), "saturday off");
ok(isSchoolDay(D("2026-10-16")), "friday has school");

const br = findBridges(D("2026-10-12"), D("2027-07-05"));
for(const b of br.slice(0,12)) console.log(b.vacation, b.skip.join(","), "→", b.from, "…", b.to, `${b.total} ימים (במקום ${b.already}) בשביל ${b.used}`);
// election: skip Sun 25 + Mon 26 -> Sat 24 .. Tue 27 = 4 days
ok(br.some(b=>b.vacation==="יום הבחירות" && b.skip.join()==="2026-10-25,2026-10-26" && b.total===4), "election bridge");
// passover: skip Thu 29 + Fri 30 Apr -> Tue 13 Apr .. Sat 1 May
ok(br.some(b=>b.vacation==="פסח" && b.skip.join()==="2027-04-29,2027-04-30" && b.to==="2027-05-01"), "passover after-bridge");
// independence day Wed 12 May: skip Thu+Fri -> Wed..Sat = 4
ok(br.some(b=>b.vacation==="יום העצמאות" && b.skip.join()==="2027-05-13,2027-05-14" && b.total===4), "independence bridge");
ok(!br.some(b=>b.vacation==="חנוכה"), "hanukkah already joins the weekends, no bridge");
ok(br.some(b=>b.vacation==="פורים" && b.skip.join()==="2027-03-21,2027-03-22" && b.total===5), "purim before");
ok(br.some(b=>b.vacation==="חופשת הקיץ" && b.skip.join()==="2027-06-20"), "last school day");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
