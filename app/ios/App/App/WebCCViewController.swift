import UIKit
import WebKit
import Capacitor

class WebCCViewController: CAPBridgeViewController {

    override func viewDidLoad() {
        super.viewDidLoad()
    }

    // Accept self-signed certificates for local server connections
    override func webView(_ webView: WKWebView,
                          didReceive challenge: URLAuthenticationChallenge,
                          completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
           let serverTrust = challenge.protectionSpace.serverTrust {
            completionHandler(.useCredential, URLCredential(trust: serverTrust))
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }
}
