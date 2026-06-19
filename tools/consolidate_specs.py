import os

specs_dir = "specs"
output_file = os.path.join(specs_dir, "system-specification.md")

files_to_merge = {
    "Overview and Comparison": ["dashboard-comparison.md", "dashboard-comparison_1.0.md"],
    "Lean Next Hono (v4.1.1)": ["lean-next-hono-v4.1.1.md", "lean-next-hono-v4.1.md"],
    "Lowspec Qwik Rust (v1.5.2)": ["lowspec-qwik-rust-v1.5.2.md", "lowspec-qwik-rust-v1.5.1.md", "lowspec-qwik-rust-v1.5.md"],
    "Performance Qwik Rust (v1.4.1)": ["performance-qwik-rust-v1.4.1.md", "performance-qwik-rust-v1.4.md"]
}

with open(output_file, 'w', encoding='utf-8') as outfile:
    outfile.write("# Dashboard Template System Specification (Consolidated)\n\n")
    outfile.write("この仕様書は複数の過去の仕様書を統合した最新の仕様書です。\n\n")
    
    for section, files in files_to_merge.items():
        outfile.write(f"## {section}\n\n")
        for filename in files:
            filepath = os.path.join(specs_dir, filename)
            if os.path.exists(filepath):
                with open(filepath, 'r', encoding='utf-8') as infile:
                    outfile.write(f"### Source: {filename}\n\n")
                    outfile.write(infile.read())
                    outfile.write("\n\n---\n\n")

for files in files_to_merge.values():
    for filename in files:
        filepath = os.path.join(specs_dir, filename)
        if os.path.exists(filepath):
            os.remove(filepath)

print("Consolidation complete.")
