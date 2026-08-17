import os
import re

src_dir = 'src'
for root, _, files in os.walk(src_dir):
    for f in files:
        if not f.endswith(('.ts', '.tsx')): continue
        path = os.path.join(root, f)
        with open(path, 'r') as file:
            content = file.read()
        
        changed = False

        # Onboarding barrel: Field, CheckRow, Desc, WordCell, Criterion, PasswordField
        if "from '@/components/molecules/onboarding'" in content:
            changed = True
            def repl_onb(m):
                imports = m.group(1).replace(' ', '').split(',')
                lines = []
                for imp in imports:
                    if not imp: continue
                    lines.append(f"import {{ {imp} }} from '@/features/onboarding/components/{imp}';")
                return '\n'.join(lines)
            content = re.sub(r"import\s+\{\s*([^}]+)\s*\}\s+from\s+'@/components/molecules/onboarding';", repl_onb, content)
            
            # For export { Field } from ...
            def repl_onb_export(m):
                imports = m.group(1).replace(' ', '').split(',')
                lines = []
                for imp in imports:
                    if not imp: continue
                    lines.append(f"export {{ {imp} }} from '@/features/onboarding/components/{imp}';")
                return '\n'.join(lines)
            content = re.sub(r"export\s+\{\s*([^}]+)\s*\}\s+from\s+'@/components/molecules/onboarding';", repl_onb_export, content)

        # Fiat barrel: Field, Select, QuoteRow
        if "from '@/components/molecules/fiat'" in content:
            changed = True
            def repl_fiat(m):
                imports = m.group(1).replace(' ', '').split(',')
                lines = []
                for imp in imports:
                    if not imp: continue
                    lines.append(f"import {{ {imp} }} from '@/features/fiat/components/{imp}';")
                return '\n'.join(lines)
            content = re.sub(r"import\s+\{\s*([^}]+)\s*\}\s+from\s+'@/components/molecules/fiat';", repl_fiat, content)

        if changed:
            with open(path, 'w') as file:
                file.write(content)
