# Interactive Name Replacement Script (Ranger Code -> Ranger Code)
# Rebrand Ranger Code to Ranger Code across the entire codebase

$DefaultReplacementPairs = @(
    # STEP 1: Full product names with space (most specific first)
    @{ From = "RANGER CODE"; To = "RANGER CODE" },
    @{ From = "Ranger Code"; To = "Ranger Code" },
    @{ From = "ranger code"; To = "ranger code" },
    @{ From = "Ranger code"; To = "Ranger code" },
    @{ From = "ranger Code"; To = "ranger Code" },
    
    # STEP 2: GitHub organization and URLs (must come before general replacements)
    @{ From = "Ranger-Org/rangercode"; To = "Ranger-Org/rangercode" },
    @{ From = "ranger-org/rangercode"; To = "ranger-org/rangercode" },
    @{ From = "Ranger-Org"; To = "Ranger-Org" },
    @{ From = "ranger-org"; To = "ranger-org" },
    
    # STEP 3: Domain/URL variations (ranger.ai -> ranger.ai)
    @{ From = "ranger.ai/discord"; To = "ranger.ai/discord" },
    @{ From = "ranger.ai/support"; To = "ranger.ai/support" },
    @{ From = "ranger.ai/docs"; To = "ranger.ai/docs" },
    @{ From = "https://ranger.ai"; To = "https://ranger.ai" },
    @{ From = "ranger.ai"; To = "ranger.ai" },
    
    # STEP 4: Reddit community
    @{ From = "r/rangercode"; To = "r/rangercode" },
    @{ From = "r/RangerCode"; To = "r/RangerCode" },
    
    # STEP 5: CamelCase/PascalCase variations
    @{ From = "RangerCode"; To = "RangerCode" },
    @{ From = "rangerCode"; To = "rangerCode" },
    @{ From = "RANGERCODE"; To = "RANGERCODE" },
    
    # STEP 6: Hyphenated variations (kebab-case) - for package names, CSS classes, etc.
    @{ From = "Ranger-Code-Nightly"; To = "Ranger-Code-Nightly" },
    @{ From = "ranger-code-nightly"; To = "ranger-code-nightly" },
    @{ From = "Ranger-Code"; To = "Ranger-Code" },
    @{ From = "ranger-code"; To = "ranger-code" },
    @{ From = "RANGER-CODE"; To = "RANGER-CODE" },
    
    # STEP 7: Dot-prefixed variations (config folders like .rangercode)
    @{ From = ".rangercodeignore"; To = ".rangercodeignore" },
    @{ From = ".rangercoderules"; To = ".rangercoderules" },
    @{ From = ".rangercode/"; To = ".rangercode/" },
    @{ From = ".rangercode"; To = ".rangercode" },
    @{ From = ".RANGERCODE"; To = ".RANGERCODE" },
    @{ From = ".Rangercode"; To = ".Rangercode" },
    
    # STEP 8: Concatenated camelCase variations for code identifiers
    @{ From = "rangercodeToken"; To = "rangercodeToken" },
    @{ From = "rangercodeOrganizationId"; To = "rangercodeOrganizationId" },
    @{ From = "rangercodeOrganization"; To = "rangercodeOrganization" },
    @{ From = "rangercodeMcp"; To = "rangercodeMcp" },
    @{ From = "rangercodeSettings"; To = "rangercodeSettings" },
    @{ From = "rangercodeApi"; To = "rangercodeApi" },
    
    # STEP 9: Translation namespace (rangercode:)
    @{ From = "rangercode:"; To = "rangercode:" },
    
    # STEP 10: NPM scope variations
    @{ From = "@rangercode/cli"; To = "@rangercode/cli" },
    @{ From = "@rangercode/"; To = "@rangercode/" },
    @{ From = "@RANGERCODE/"; To = "@RANGERCODE/" },
    
    # STEP 11: Concatenated lowercase (package names, identifiers, filenames)
    @{ From = "rangercode.json"; To = "rangercode.json" },
    @{ From = "rangercode.css"; To = "rangercode.css" },
    @{ From = "rangercode.ts"; To = "rangercode.ts" },
    @{ From = "rangercode"; To = "rangercode" },
    @{ From = "Rangercode"; To = "Rangercode" },
    
    # STEP 12: Underscore variations (environment variables, constants)
    @{ From = "RANGERCODE_BACKEND_BASE_URL"; To = "RANGERCODE_BACKEND_BASE_URL" },
    @{ From = "RANGERCODE_"; To = "RANGERCODE_" },
    @{ From = "RANGER_CODE"; To = "RANGER_CODE" },
    @{ From = "ranger_code"; To = "ranger_code" },
    @{ From = "Ranger_Code"; To = "Ranger_Code" },
    @{ From = "ranger_code_openrouter"; To = "ranger_code_openrouter" },
    
    # STEP 13: Class/Type names with Ranger prefix
    @{ From = "RangerOrganization"; To = "RangerOrganization" },
    @{ From = "RangerOrganizationSettings"; To = "RangerOrganizationSettings" },
    @{ From = "RangerOrganizationSchema"; To = "RangerOrganizationSchema" },
    @{ From = "RangerOrganizationSettingsSchema"; To = "RangerOrganizationSettingsSchema" },
    @{ From = "RangerLogo"; To = "RangerLogo" },
    @{ From = "RangerAuth"; To = "RangerAuth" },
    @{ From = "RangerCodeAuth"; To = "RangerCodeAuth" },
    @{ From = "RangerIdentity"; To = "RangerIdentity" },
    @{ From = "RangerApi"; To = "RangerApi" },
    
    # STEP 14: Function/variable names with ranger/Ranger prefix
    @{ From = "useRangerIdentity"; To = "useRangerIdentity" },
    @{ From = "handleRangerApiKeyChange"; To = "handleRangerApiKeyChange" },
    @{ From = "rangerOrgProps"; To = "rangerOrgProps" },
    @{ From = "_rangerOrgProps"; To = "_rangerOrgProps" },
    @{ From = "setRangerOrgProps"; To = "setRangerOrgProps" },
    @{ From = "getRangerOrgProps"; To = "getRangerOrgProps" },
    @{ From = "isRangerOrgMode"; To = "isRangerOrgMode" },
    @{ From = "currentProfileRangercodeToken"; To = "currentProfileRangercodeToken" },
    
    # STEP 15: SVG/Branding specific
    @{ From = "Ranger_Code_Branding"; To = "Ranger_Code_Branding" },
    @{ From = "Ranger Code Branding"; To = "Ranger Code Branding" },
    
    # STEP 16: Slash commands and GitHub issues
    @{ From = "RangerCode GitHub"; To = "RangerCode GitHub" },
    
    # STEP 17: Single word replacements (MUST be last to avoid partial matches)
    @{ From = "RANGER"; To = "RANGER" },
    @{ From = "Ranger"; To = "Ranger" },
    @{ From = "ranger"; To = "ranger" }
)

$ExcludeFolders = @(".git", "node_modules", ".vs", "bin", "obj", "dist", "build", ".next", ".vscode", "coverage", "target")
$ExcludeExtensions = @(".exe", ".dll", ".pdb", ".zip", ".tar", ".gz", ".jpg", ".jpeg", ".png", ".gif", ".ico", ".pdf", ".mp4", ".mp3", ".wav", ".mov", ".avi", ".lock")

# Color coded output functions
function Write-Info { 
    param([string]$Message)
    Write-Host $Message -ForegroundColor Cyan 
}

function Write-Success { 
    param([string]$Message)
    Write-Host $Message -ForegroundColor Green 
}

function Write-Warning { 
    param([string]$Message)
    Write-Host $Message -ForegroundColor Yellow 
}

function Write-Error { 
    param([string]$Message)
    Write-Host $Message -ForegroundColor Red 
}

function Write-DryRun { 
    param([string]$Message)
    Write-Host "[PREVIEW] $Message" -ForegroundColor Magenta 
}

function Write-Header {
    param([string]$Message)
    Write-Host ""
    Write-Host ("=" * 60) -ForegroundColor Blue
    Write-Host $Message -ForegroundColor White
    Write-Host ("=" * 60) -ForegroundColor Blue
    Write-Host ""
}

# Clear screen for better presentation
Clear-Host

Write-Header "RANGER CODE -> RANGER CODE REBRANDING TOOL"

Write-Info "This script will rebrand Ranger Code to Ranger Code in:"
Write-Info "  - File contents"
Write-Info "  - File names"
Write-Info "  - Folder names"
Write-Host ""

# Get workspace path interactively
do {
    Write-Host "Enter the workspace path (or drag and drop folder here):" -ForegroundColor Yellow
    $WorkspacePath = Read-Host
    
    # Remove quotes if present (from drag and drop)
    $WorkspacePath = $WorkspacePath.Trim('"')
    $WorkspacePath = $WorkspacePath.Trim("'")
    
    if ([string]::IsNullOrWhiteSpace($WorkspacePath)) {
        Write-Error "Path cannot be empty. Please try again."
        continue
    }
    
    if (-not (Test-Path $WorkspacePath)) {
        Write-Error "Path does not exist: $WorkspacePath"
        Write-Host "Please enter a valid path." -ForegroundColor Yellow
        continue
    }
    
    if (-not (Test-Path $WorkspacePath -PathType Container)) {
        Write-Error "Path is not a directory: $WorkspacePath"
        Write-Host "Please enter a directory path." -ForegroundColor Yellow
        continue
    }
    
    break
} while ($true)

$WorkspacePath = Resolve-Path $WorkspacePath
Write-Success "Workspace path validated: $WorkspacePath"
Write-Host ""

# Ask about replacements
Write-Host "Choose replacement option:" -ForegroundColor Yellow
Write-Host "1. Use default (Ranger Code -> Ranger Code rebranding)" -ForegroundColor White
Write-Host "2. Enter custom replacements" -ForegroundColor White
Write-Host ""
$choice = Read-Host "Enter choice (1 or 2)"

$Replacements = $DefaultReplacementPairs

if ($choice -eq "2") {
    $Replacements = @()
    Write-Host ""
    Write-Info "Enter custom replacements (empty from to finish):"
    
    while ($true) {
        $from = Read-Host "Replace FROM"
        if ([string]::IsNullOrWhiteSpace($from)) { break }
        
        $to = Read-Host "Replace TO  "
        $Replacements += @{ From = $from; To = $to }
        Write-Success "Added: $from -> $to"
        Write-Host ""
    }
    
    if ($Replacements.Count -eq 0) {
        Write-Warning "No replacements defined. Using defaults."
        $Replacements = $DefaultReplacementPairs
    }
}

Write-Host ""
Write-Header "REPLACEMENTS TO BE APPLIED"

Write-Info "Total replacement patterns: $($Replacements.Count)"
Write-Host ""
foreach ($pair in $Replacements) {
    Write-Info "  '$($pair.From)' -> '$($pair.To)'"
}

Write-Host ""

# Ask for dry run
Write-Host "Do you want to preview changes first (recommended)? [Y/N]" -ForegroundColor Yellow
$dryRunChoice = Read-Host
$DryRun = $dryRunChoice -ne 'N' -and $dryRunChoice -ne 'n'

if ($DryRun) {
    Write-Warning "PREVIEW MODE - No actual changes will be made"
} else {
    Write-Warning "LIVE MODE - Changes will be applied immediately"
    Write-Host "Are you sure you want to proceed? [Y/N]" -ForegroundColor Red
    $confirm = Read-Host
    if ($confirm -ne 'Y' -and $confirm -ne 'y') {
        Write-Info "Operation cancelled."
        Write-Host "Press any key to exit..."
        $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
        exit
    }
}

# Statistics
$stats = [ordered]@{
    FilesScanned = 0
    FilesModified = 0
    FoldersRenamed = 0
    FilesRenamed = 0
    ContentReplacements = 0
    Errors = 0
    StartTime = Get-Date
}

# Function to check if path should be excluded
function Should-Exclude {
    param([string]$Path)
    
    foreach ($excludeFolder in $ExcludeFolders) {
        $pattern1 = "*\$excludeFolder\*"
        $pattern2 = "*\$excludeFolder"
        $pattern3 = "*/$excludeFolder/*"
        $pattern4 = "*/$excludeFolder"
        
        if ($Path -like $pattern1 -or $Path -like $pattern2 -or $Path -like $pattern3 -or $Path -like $pattern4) {
            return $true
        }
    }
    return $false
}

# Function to check if file should be excluded by extension
function Should-ExcludeFile {
    param([string]$FilePath)
    
    $extension = [System.IO.Path]::GetExtension($FilePath)
    return $ExcludeExtensions -contains $extension
}

# Function to perform replacements in a string
function Replace-Names {
    param([string]$Text)
    
    $modified = $Text
    
    # Process each replacement pair using case-sensitive regex
    foreach ($pair in $Replacements) {
        # Build case-sensitive regex pattern
        $pattern = [regex]::Escape($pair.From)
        # Use .NET regex for case-sensitive replacement
        $regex = [regex]::new($pattern, [System.Text.RegularExpressions.RegexOptions]::None)
        $modified = $regex.Replace($modified, $pair.To)
    }
    
    return $modified
}

# Step 1: Replace content in files
Write-Header "STEP 1: REPLACING CONTENT IN FILES"

$files = Get-ChildItem -Path $WorkspacePath -File -Recurse -ErrorAction SilentlyContinue
$totalFiles = $files.Count
$currentFile = 0

foreach ($file in $files) {
    $currentFile++
    
    if (Should-Exclude $file.FullName) {
        continue
    }
    
    if (Should-ExcludeFile $file.FullName) {
        continue
    }
    
    $stats.FilesScanned++
    
    # Show progress
    if ($currentFile % 10 -eq 0 -or $currentFile -eq $totalFiles) {
        Write-Host "`rProcessing files: $currentFile/$totalFiles" -NoNewline -ForegroundColor Gray
    }
    
    try {
        # Read file content with proper encoding using LiteralPath to handle special characters
        $content = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 -ErrorAction Stop
        
        if ($null -eq $content -or $content.Length -eq 0) {
            continue
        }
        
        $newContent = Replace-Names $content
        
        if ($content -ne $newContent) {
            if ($DryRun) {
                Write-Host "`r                                                    `r" -NoNewline
                Write-DryRun "Would modify: $($file.FullName)"
            } else {
                # Write with UTF8 encoding without BOM
                $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
                [System.IO.File]::WriteAllText($file.FullName, $newContent, $utf8NoBom)
                Write-Host "`r                                                    `r" -NoNewline
                Write-Success "Modified: $($file.FullName)"
            }
            $stats.FilesModified++
            
            # Count replacements
            foreach ($pair in $Replacements) {
                $pattern = [regex]::Escape($pair.From)
                $regex = [regex]::new($pattern, [System.Text.RegularExpressions.RegexOptions]::None)
                $matches = $regex.Matches($content)
                $stats.ContentReplacements += $matches.Count
            }
        }
    }
    catch {
        $errorMsg = $_.Exception.Message
        if ($errorMsg -notlike "*binary file*" -and $errorMsg -notlike "*used by another process*") {
            Write-Warning "Error processing $($file.Name): $errorMsg"
            $stats.Errors++
        }
    }
}

Write-Host "`r                                                    `r" -NoNewline
Write-Success "Content replacement complete. Modified $($stats.FilesModified) files."

# Step 2: Rename files
Write-Header "STEP 2: RENAMING FILES"

$filesToRename = Get-ChildItem -Path $WorkspacePath -File -Recurse -ErrorAction SilentlyContinue | Sort-Object { $_.FullName.Length } -Descending

foreach ($file in $filesToRename) {
    if (Should-Exclude $file.FullName) {
        continue
    }
    
    $newName = Replace-Names $file.Name
    
    if ($file.Name -ne $newName) {
        $newPath = Join-Path $file.DirectoryName $newName
        
        if ($DryRun) {
            Write-DryRun "Would rename file: $($file.Name) -> $newName"
            $stats.FilesRenamed++
        } else {
            try {
                if (Test-Path $newPath) {
                    Write-Warning "Target already exists, skipping: $newPath"
                } else {
                    Rename-Item -Path $file.FullName -NewName $newName -Force
                    Write-Success "Renamed file: $($file.Name) -> $newName"
                    $stats.FilesRenamed++
                }
            }
            catch {
                Write-Error "Failed to rename: $($file.FullName)"
                $stats.Errors++
            }
        }
    }
}

if ($stats.FilesRenamed -eq 0 -and -not $DryRun) {
    Write-Info "No files needed renaming."
}

# Step 3: Rename folders
Write-Header "STEP 3: RENAMING FOLDERS"

$folders = Get-ChildItem -Path $WorkspacePath -Directory -Recurse -ErrorAction SilentlyContinue | Sort-Object { $_.FullName.Length } -Descending

foreach ($folder in $folders) {
    if (Should-Exclude $folder.FullName) {
        continue
    }
    
    $newName = Replace-Names $folder.Name
    
    if ($folder.Name -ne $newName) {
        $newPath = Join-Path $folder.Parent.FullName $newName
        
        if ($DryRun) {
            Write-DryRun "Would rename folder: $($folder.Name) -> $newName"
            $stats.FoldersRenamed++
        } else {
            try {
                if (Test-Path $newPath) {
                    Write-Warning "Target already exists, skipping: $newPath"
                } else {
                    Rename-Item -Path $folder.FullName -NewName $newName -Force
                    Write-Success "Renamed folder: $($folder.Name) -> $newName"
                    $stats.FoldersRenamed++
                }
            }
            catch {
                Write-Error "Failed to rename: $($folder.FullName)"
                $stats.Errors++
            }
        }
    }
}

if ($stats.FoldersRenamed -eq 0 -and -not $DryRun) {
    Write-Info "No folders needed renaming."
}

# Calculate duration
$duration = (Get-Date) - $stats.StartTime
$minutes = [int]$duration.TotalMinutes
$seconds = [int]$duration.Seconds

# Final Summary
Write-Header "OPERATION COMPLETE!"

Write-Host "SUMMARY STATISTICS" -ForegroundColor White
Write-Host ("-" * 40) -ForegroundColor Gray
Write-Host ""

Write-Info "Files scanned:        $($stats.FilesScanned)"
Write-Success "Files modified:       $($stats.FilesModified)"
Write-Success "Content replacements: $($stats.ContentReplacements)"
Write-Success "Files renamed:        $($stats.FilesRenamed)"
Write-Success "Folders renamed:      $($stats.FoldersRenamed)"

if ($stats.Errors -gt 0) {
    Write-Error "Errors encountered:   $($stats.Errors)"
}

Write-Host ""
Write-Info "Time taken: $minutes minutes $seconds seconds"
Write-Host ""

if ($DryRun) {
    Write-Host ("=" * 60) -ForegroundColor Yellow
    Write-Warning "This was a PREVIEW RUN. No actual changes were made."
    Write-Info "Run the script again and choose N for preview to apply changes."
    Write-Host ("=" * 60) -ForegroundColor Yellow
} else {
    Write-Host ("=" * 60) -ForegroundColor Green
    Write-Success "All changes have been applied successfully!"
    Write-Host ("=" * 60) -ForegroundColor Green
}

Write-Host ""
Write-Host "Press any key to exit..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')