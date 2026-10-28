# Makes a clearly-marked TEST slip image for testing Fit Her's own slip check.
# Not a real payment and not a copy of any bank's design: plain text only.
#   python3 scripts/make_test_slip.py <amount> [pass|wrong_receiver|old_date|no_ref] [out.png]
import sys, random, datetime
from PIL import Image, ImageDraw, ImageFont

amount = int(sys.argv[1]) if len(sys.argv) > 1 else 3500
case = sys.argv[2] if len(sys.argv) > 2 else "pass"
out = sys.argv[3] if len(sys.argv) > 3 else f"test_slip_{case}_{amount}.png"

def font(size, bold=False):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
              "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"]:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            pass
    return ImageFont.load_default()

today = datetime.date.today()
date = today - datetime.timedelta(days=20) if case == "old_date" else today
receiver = "Ali Raza" if case == "wrong_receiver" else "Fit Her"
number = "0300****1111" if case == "wrong_receiver" else "0323****5417"
tid = "" if case == "no_ref" else "".join(random.choice("0123456789") for _ in range(11))

lines = [
    ("TEST SLIP - NOT A REAL PAYMENT", font(30, True), (200, 30, 30)),
    ("", font(10), (0, 0, 0)),
    ("JazzCash", font(28, True), (20, 20, 20)),
    ("Money Sent Successfully", font(22), (20, 20, 20)),
    (f"Amount: Rs {amount:,}", font(26, True), (20, 20, 20)),
    (f"To: {receiver}", font(22), (20, 20, 20)),
    (f"Account: {number}", font(22), (20, 20, 20)),
    ("From: Test User", font(22), (20, 20, 20)),
    (f"Date: {date.strftime('%d/%m/%Y')}  15:40", font(22), (20, 20, 20)),
    (f"TID: {tid}" if tid else "", font(22), (20, 20, 20)),
    ("", font(10), (0, 0, 0)),
    ("TEST SLIP - NOT A REAL PAYMENT", font(30, True), (200, 30, 30)),
]
img = Image.new("RGB", (720, 640), "white")
d = ImageDraw.Draw(img)
y = 30
for text, f, col in lines:
    if text:
        d.text((40, y), text, font=f, fill=col)
    y += 48
img.save(out)
print(out, "TID", tid or "(none)")
