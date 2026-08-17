import re
import os

with open('src/state/store.ts', 'r') as f:
    content = f.read()

# We won't parse it automatically. We will extract known blocks and replace them.

