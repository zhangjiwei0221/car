// ClickRecorder_mac.swift —— 记录客户端的全局点击（只读监听，不改任何应用）
//
// 编译：swiftc -O 03_工具/正式版/ClickRecorder_mac.swift -o /tmp/click_recorder
// 运行：/tmp/click_recorder ~/Downloads/客户端点击_$(date +%H%M%S).jsonl
//
// 权限：需要在「系统设置 → 隐私与安全性 → 辅助功能」里给**运行它的终端**授权（一次性）。
// 输出：每行一个 JSON：{"t":秒,"type":"leftDown","x":..,"y":..,"window":"..."}
//       启动时先写一行 window，给出目标窗口的位置与大小（用于把坐标换算成格子）。
// 注意：坐标是屏幕坐标（左上角为原点，单位 pt）。

import Cocoa

let args = CommandLine.arguments
let outPath = args.count > 1 ? args[1] : (NSHomeDirectory() + "/Downloads/clicks.jsonl")
let ownerFilter = args.count > 2 ? args[2] : "ParkPassenger"

FileManager.default.createFile(atPath: outPath, contents: nil)
guard let gHandle0 = FileHandle(forWritingAtPath: outPath) else { print("无法写文件: \(outPath)"); exit(2) }
let gHandle = gHandle0
let gLock = NSLock()

func emit(_ dict: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
       let line = String(data: data, encoding: .utf8) {
        gLock.lock()
        gHandle.write((line + "\n").data(using: .utf8)!)
        gLock.unlock()
    }
}

// 找目标窗口的位置（可能多个，全写出来）
func windows(of owner: String) -> [[String: Any]] {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return [] }
    return list.filter { ($0[kCGWindowOwnerName as String] as? String)?.contains(owner) == true }
}

for w in windows(of: ownerFilter) {
    let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
    emit(["type": "window", "owner": ownerFilter, "bounds": b])
}

let mask: CGEventMask = (1 << CGEventType.leftMouseDown.rawValue)
guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .listenOnly,
    eventsOfInterest: mask,
    callback: { _, type, event, _ in
        if type == .leftMouseDown {
            let p = event.location
            emit(["t": Date().timeIntervalSince1970, "type": "leftDown",
                  "x": Double(p.x), "y": Double(p.y)])
        }
        return Unmanaged.passUnretained(event)
    },
    userInfo: nil
) else {
    print("无法创建事件监听。请到 系统设置 → 隐私与安全性 → 辅助功能 给终端授权后重试。")
    exit(3)
}

let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
print("记录中 → \(outPath)")
print("按 Ctrl-C 结束。")
CFRunLoopRun()
