# Builds shop.xlsx: deterministic rows for the excel-mcp-server benchmark suite. Run via
# `uv run --with openpyxl==3.1.5 python3 seed.py` from benchmark/fixtures/build.sh at image build.
import openpyxl

wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Orders"
ws.append(["id", "customer", "amount", "status"])
for row in [
    (1, "Maria Papadopoulou", 120, "shipped"),
    (2, "Sofia Andersson", 75, "pending"),
    (3, "Nikos Pappas", 300, "shipped"),
    (4, "Elena Kostova", 45, "cancelled"),
    (5, "Jonas Berg", 297, "pending"),
]:
    ws.append(row)
wb.save("shop.xlsx")
