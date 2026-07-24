# Fix Windows-1252 0x80 bytes (em-dash) to proper UTF-8 em-dash (U+2014)
$files = @(
    'src/core/engine/LangGraphEngine.ts',
    'src/core/engine/LeanEngine.ts',
    'src/core/engine/SwarmEngine.ts',
    'src/core/orchestrator.ts',
    'src/tools/toolSchemas.ts'
)

$emDashBytes = [System.Text.Encoding]::UTF8.GetBytes("\u2014")  # 0xE2 0x80 0x94

foreach ($f in $files) {
    $bytes = [System.IO.File]::ReadAllBytes($f)
    $count = 0
    $newBytes = New-Object System.Collections.Generic.List[byte]
    
    $i = 0
    while ($i -lt $bytes.Length) {
        if ($bytes[$i] -eq 0x80) {
            # Replace single 0x80 byte with UTF-8 encoded em-dash (3 bytes)
            $newBytes.AddRange($emDashBytes)
            $count++
            $i++
        } else {
            $newBytes.Add($bytes[$i])
            $i++
        }
    }
    
    if ($count -gt 0) {
        [System.IO.File]::WriteAllBytes($f, $newBytes.ToArray())
        Write-Host "Fixed $f : replaced $count occurrences of 0x80 with UTF-8 em-dash"
    } else {
        Write-Host "$f : no 0x80 bytes found (already clean)"
    }
}
