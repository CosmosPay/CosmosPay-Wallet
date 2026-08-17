import re
import os

with open('src/state/store.ts', 'r') as f:
    content = f.read()

# We'll just define the boundaries based on comments.
boundaries = {
    'boot': r'/\* ----------------------------- boot ----------------------------- \*/',
    'data': r'/\* ------------------------- data loading ------------------------- \*/',
    'favs': r'/\* --------------------------- favorite assets -------------------------- \*/',
    'onboarding': r'/\* --------------------------- onboarding ------------------------- \*/',
    'unlock': r'/\* ----------------------------- unlock --------------------------- \*/',
    'multi': r'/\* ------------------------- multi-wallet ------------------------- \*/',
    'network': r'/\* -------------------------- network switch ---------------------- \*/',
    'money': r'/\* ----------------------------- money ---------------------------- \*/',
    'cosmos': r'/\* --------------------------- CosmosPay -------------------------- \*/',
    'lp': r'/\* ------------------------- liquidity pools ---------------------- \*/',
    'export': r'/\* ----------------------------- export --------------------------- \*/',
    'nav': r'/\* --------------------------- navigation ------------------------- \*/',
    'back': r'/\* ------------------------- back navigation ------------------------- \*/',
    'end': r'return \{'
}

def get_block(start_key, end_key):
    start_match = re.search(boundaries[start_key], content)
    end_match = re.search(boundaries[end_key], content)
    if not start_match or not end_match: return ""
    return content[start_match.start():end_match.start()]

print("Keys matched:")
for k in boundaries:
    print(k, bool(re.search(boundaries[k], content)))

