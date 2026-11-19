import UIKit
import WebKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = WebViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}

final class WebViewController: UIViewController, WKUIDelegate, WKNavigationDelegate {
    private let startURL = URL(string: "https://adis.byred.fun")!
    private var webView: WKWebView!

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        self.webView = webView
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.load(URLRequest(url: startURL))
    }

    // Grant mic/camera to our own site without a second in-webview prompt;
    // iOS still enforces the system-level permission.
    @available(iOS 15.0, *)
    func webView(_ webView: WKWebView,
                 requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.host == startURL.host ? .grant : .prompt)
    }

    // External links (tel:, mailto:, other hosts) leave the app.
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url,
              url.host == startURL.host || url.scheme == "about" || url.scheme == "data" || url.scheme == "blob" else {
            if let url = navigationAction.request.url, UIApplication.shared.canOpenURL(url) {
                UIApplication.shared.open(url)
            }
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    // No network / server down: show a retry screen instead of a blank page.
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleLoadError(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleLoadError(error)
    }

    private func handleLoadError(_ error: Error) {
        let e = error as NSError
        // Cancelled loads (external links handed to Safari, fast re-navigation) are not failures
        guard e.domain == NSURLErrorDomain, e.code != NSURLErrorCancelled else { return }
        let html = """
        <!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font:17px -apple-system,sans-serif;
        background:#0f0f14;color:#eee;text-align:center}div{padding:24px}p{color:#999}
        a{display:inline-block;margin-top:16px;padding:14px 28px;border-radius:14px;background:#5b5bd6;color:#fff;text-decoration:none}</style>
        </head><body><div><h2>Нет соединения с Adis</h2><p>Проверьте интернет и попробуйте ещё раз.</p>
        <a href="\(startURL.absoluteString)">Повторить</a></div></body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }
}
