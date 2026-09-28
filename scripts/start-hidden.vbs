' ==============================================================================
' eSSL Attendance Sync Agent - Hidden Background Launcher
' Starts the Node.js agent completely hidden in background without any CMD window
' ==============================================================================
Option Explicit

Dim fso, shell, scriptDir, agentDir, logsDir, nodeScript, bootLog, nodeExe
Dim testPaths(5), i, foundNode, cmdStr

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
agentDir = fso.GetParentFolderName(scriptDir)
logsDir = agentDir & "\logs"

If Not fso.FolderExists(logsDir) Then
    fso.CreateFolder(logsDir)
End If

nodeScript = Chr(34) & agentDir & "\dist\index.js" & Chr(34)
bootLog = Chr(34) & agentDir & "\logs\agent-boot.log" & Chr(34)

' 1. Check if dist\index.js exists
If Not fso.FileExists(agentDir & "\dist\index.js") Then
    MsgBox "Cannot find " & agentDir & "\dist\index.js." & vbCrLf & _
           "Please run 'npm run build' in the agent directory first.", vbCritical, "eSSL Attendance Sync"
    WScript.Quit 1
End If

' 2. Locate node.exe
testPaths(0) = shell.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")
testPaths(1) = shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%\nodejs\node.exe")
testPaths(2) = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\node\node.exe")
testPaths(3) = shell.ExpandEnvironmentStrings("%APPDATA%\nvm\current\node.exe")
testPaths(4) = shell.ExpandEnvironmentStrings("%USERPROFILE%\AppData\Local\Programs\node\node.exe")

foundNode = ""
For i = 0 To UBound(testPaths) - 1
    If testPaths(i) <> "" And fso.FileExists(testPaths(i)) Then
        foundNode = testPaths(i)
        Exit For
    End If
Next

If foundNode <> "" Then
    nodeExe = Chr(34) & foundNode & Chr(34)
Else
    nodeExe = "node.exe"
End If

' 3. Set Working Directory
shell.CurrentDirectory = agentDir

' 4. Launch hidden with stdout and stderr redirected to logs\agent-boot.log
cmdStr = "cmd.exe /c " & nodeExe & " " & nodeScript & " start >> " & bootLog & " 2>&1"
shell.Run cmdStr, 0, False
