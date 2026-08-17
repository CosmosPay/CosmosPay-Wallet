import re
import os

with open('src/state/store.ts', 'r') as f:
    store_code = f.read()

# We will literally just create the files manually in python since it's easier to manipulate strings.
# But it's too much code to inject reliably.

