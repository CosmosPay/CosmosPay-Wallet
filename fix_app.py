import re

with open('src/app/WalletApp.tsx', 'r') as f:
    lines = f.readlines()

new_lines = []
for line in lines:
    if line.startswith('import { Welcome, Backup, Verify, Import, ProfileSetup, PasswordSetup } from'):
        new_lines.append("import { Welcome } from '@/features/onboarding/Welcome';\n")
        new_lines.append("import { Backup } from '@/features/onboarding/Backup';\n")
        new_lines.append("import { Verify } from '@/features/onboarding/Verify';\n")
        new_lines.append("import { Import } from '@/features/onboarding/Import';\n")
        new_lines.append("import { ProfileSetup } from '@/features/onboarding/ProfileSetup';\n")
        new_lines.append("import { PasswordSetup } from '@/features/onboarding/PasswordSetup';\n")
    elif line.startswith('import { Home, Earn, Markets, Profile, Asset, EditProfile } from'):
        new_lines.append("import { Home } from '@/features/main/Home';\n")
        new_lines.append("import { Earn } from '@/features/main/Earn';\n")
        new_lines.append("import { Markets } from '@/features/main/Markets';\n")
        new_lines.append("import { Profile } from '@/features/main/Profile';\n")
        new_lines.append("import { Asset } from '@/features/main/Asset';\n")
        new_lines.append("import { EditProfile } from '@/features/main/EditProfile';\n")
    elif line.startswith('import { Receive, Send, Confirm, Success, Swap, History, PayLink } from'):
        new_lines.append("import { Receive } from '@/features/money/Receive';\n")
        new_lines.append("import { Send } from '@/features/money/Send';\n")
        new_lines.append("import { Confirm } from '@/features/money/Confirm';\n")
        new_lines.append("import { Success } from '@/features/money/Success';\n")
        new_lines.append("import { Swap } from '@/features/money/Swap';\n")
        new_lines.append("import { History } from '@/features/money/History';\n")
        new_lines.append("import { PayLink } from '@/features/money/PayLink';\n")
    elif line.startswith('import { AddNetwork, AddAsset, ScanQR, Operations, SignTx } from'):
        new_lines.append("import { AddNetwork } from '@/features/extras/AddNetwork';\n")
        new_lines.append("import { AddAsset } from '@/features/extras/AddAsset';\n")
        new_lines.append("import { ScanQR } from '@/features/extras/ScanQR';\n")
        new_lines.append("import { Operations } from '@/features/extras/Operations';\n")
        new_lines.append("import { SignTx } from '@/features/extras/SignTx';\n")
    elif line.startswith('import { Fiat, BankAccount, Deposit, Withdraw } from'):
        new_lines.append("import { Fiat } from '@/features/fiat/Fiat';\n")
        new_lines.append("import { BankAccount } from '@/features/fiat/BankAccount';\n")
        new_lines.append("import { Deposit } from '@/features/fiat/Deposit';\n")
        new_lines.append("import { Withdraw } from '@/features/fiat/Withdraw';\n")
    elif line.startswith('import { Liquidity, LpDeposit, LpWithdraw } from'):
        new_lines.append("import { Liquidity } from '@/features/liquidity/Liquidity';\n")
        new_lines.append("import { Deposit as LpDeposit } from '@/features/liquidity/Deposit';\n")
        new_lines.append("import { Withdraw as LpWithdraw } from '@/features/liquidity/Withdraw';\n")
    else:
        new_lines.append(line)

with open('src/app/WalletApp.tsx', 'w') as f:
    f.writelines(new_lines)
