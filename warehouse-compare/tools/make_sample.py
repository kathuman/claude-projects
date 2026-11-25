# Writes data/sample-orders.csv: two days of synthetic order lines for trying
# the import. Popularity is Zipf-like (exponent 0.9) over 5,000 SKUs with
# shuffled codes; orders have geometric line counts with mean 3.
#   python warehouse-compare/tools/make_sample.py
import os, random
random.seed(20261125)
N_SKU, ORDERS_PER_DAY, DAYS = 5000, 1500, ["2026-11-02", "2026-11-03"]
codes = ["SKU-%05d" % i for i in range(1, N_SKU + 1)]
random.shuffle(codes)
w = [1 / (r + 1) ** 0.9 for r in range(N_SKU)]
cum, acc = [], 0.0
for x in w:
    acc += x; cum.append(acc)
def draw():
    u = random.random() * acc
    lo, hi = 0, N_SKU - 1
    while lo < hi:
        m = (lo + hi) // 2
        if cum[m] < u: lo = m + 1
        else: hi = m
    return codes[lo]
rows = ["fecha;pedido;artículo;cantidad"]
n = 0
for day in DAYS:
    for o in range(ORDERS_PER_DAY):
        n += 1
        lines = 1
        while random.random() < 2 / 3 and lines < 15: lines += 1      # geometric, mean 3
        seen = set()
        while len(seen) < lines: seen.add(draw())
        for s in sorted(seen): rows.append("%s;P%06d;%s;%d" % (day, n, s, random.randint(1, 4)))
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "sample-orders.csv")
open(path, "w", encoding="utf-8", newline="\n").write("\n".join(rows) + "\n")
print(len(rows) - 1, "lines,", n, "orders")
