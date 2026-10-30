"""Integration tests for the Helium API using only the Python standard library.

Run from the repository root:
    python -m unittest backend.tests.test_api -v
"""

from __future__ import annotations

import os
import tempfile
import unittest

os.environ.setdefault("HELIUM_DATA_DIR", tempfile.mkdtemp(prefix="helium-test-"))
os.environ.setdefault("HELIUM_EMBEDDING_BACKEND", "hash")
os.environ.setdefault("HELIUM_ENABLE_LLM", "0")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


class HeliumApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client_context = TestClient(app)
        cls.client = cls.client_context.__enter__()
        response = cls.client.post("/api/demo/seed")
        assert response.status_code == 202, response.text

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client_context.__exit__(None, None, None)

    def test_01_health(self) -> None:
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["app"], "Helium")
        self.assertIn(payload["index"]["index_type"], {"faiss", "numpy"})

    def test_02_seeded_documents(self) -> None:
        documents = self.client.get("/api/documents").json()["documents"]
        self.assertGreaterEqual(len(documents), 3)
        self.assertTrue(all(document["status"] == "ready" for document in documents))
        self.assertGreaterEqual(sum(document["chunk_count"] for document in documents), 7)

    def test_03_remote_query_surfaces_contradictions(self) -> None:
        response = self.client.post(
            "/api/query",
            json={"query": "What is the remote work policy for senior engineers?", "top_k": 8},
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertGreaterEqual(payload["chunks_analyzed"], 2)
        self.assertTrue(payload["citations"])
        self.assertLess(payload["consistency_score"], 100)
        self.assertTrue(
            any(
                conflict["relationship"] in {"contradiction", "conditional_conflict"}
                for conflict in payload["conflicts"]
            )
        )
        self.assertIn("### Direct answer", payload["answer"])
        self.assertIn("[[S", payload["answer"])

    def test_04_meal_query_stays_on_topic(self) -> None:
        response = self.client.post(
            "/api/query",
            json={"query": "What are the meal reimbursement limits?", "top_k": 8},
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertGreaterEqual(payload["chunks_analyzed"], 1)
        self.assertTrue(payload["claims"])
        self.assertTrue(all("meal" in claim["raw_text"].lower() for claim in payload["claims"]))

    def test_05_conflict_review(self) -> None:
        query = self.client.post(
            "/api/query",
            json={"query": "When are receipts required?", "top_k": 8},
        ).json()
        self.assertTrue(query["conflicts"])
        conflict = query["conflicts"][0]
        response = self.client.post(
            f"/api/admin/conflicts/{conflict['id']}/resolve",
            json={
                "action": "accept_newest",
                "reviewer": "Test Reviewer",
                "note": "Confirm the newest revision.",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "resolved")
        self.assertIn(
            response.json()["active_claim_id"],
            {conflict["claim_a"]["claim_id"], conflict["claim_b"]["claim_id"]},
        )
        reloaded = self.client.get(f"/api/history/{query['query_id']}").json()
        updated = next(
            item for item in reloaded["relationships"] if item["id"] == conflict["id"]
        )
        self.assertEqual(updated["status"], "resolved")

    def test_06_duplicate_and_invalid_upload(self) -> None:
        content = b"Effective Date: January 1, 2025\nTest Policy\nEmployees must wear badges."
        first = self.client.post(
            "/api/ingest",
            files=[("files", ("badge_policy.txt", content, "text/plain"))],
        )
        self.assertEqual(first.status_code, 202, first.text)
        second = self.client.post(
            "/api/ingest",
            files=[("files", ("badge_policy_copy.txt", content, "text/plain"))],
        )
        self.assertEqual(second.status_code, 202, second.text)
        self.assertTrue(second.json()["duplicate"])

        invalid = self.client.post(
            "/api/ingest",
            files=[("files", ("badge_policy.exe", b"nope", "application/octet-stream"))],
        )
        self.assertEqual(invalid.status_code, 415)

    def test_07_history_and_delete(self) -> None:
        history = self.client.get("/api/history").json()
        self.assertTrue(history)
        documents = self.client.get("/api/documents").json()["documents"]
        victim = next(
            document for document in documents if document["filename"] == "HR_Policy_2024.txt"
        )
        response = self.client.delete(f"/api/documents/{victim['id']}")
        self.assertEqual(response.status_code, 200, response.text)
        remaining = self.client.get("/api/documents").json()["documents"]
        self.assertTrue(all(document["id"] != victim["id"] for document in remaining))

    def test_08_scan_selected_documents(self) -> None:
        documents = self.client.get("/api/documents").json()["documents"]
        by_name = {document["filename"]: document for document in documents}
        selected = [
            by_name["Remote_Work_Addendum_2026.txt"],
            by_name["Expense_Reimbursement_2025.txt"],
        ]
        self.assertEqual(len(selected), 2)
        response = self.client.post(
            "/api/scan",
            json={"document_ids": [document["id"] for document in selected]},
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertTrue(payload["scan_id"].startswith("scan_"))
        self.assertGreaterEqual(payload["claims_analyzed"], 1)
        self.assertGreaterEqual(payload["pairs_analyzed"], 1)
        self.assertTrue(payload["relationships"])
        for conflict in payload["relationships"]:
            self.assertNotEqual(
                conflict["claim_a"]["document_id"], conflict["claim_b"]["document_id"]
            )
        self.assertTrue(
            any(
                conflict["relationship"] in {"contradiction", "conditional_conflict"}
                for conflict in payload["conflicts"]
            )
        )

        reloaded = self.client.get(f"/api/scan/{payload['scan_id']}")
        self.assertEqual(reloaded.status_code, 200, reloaded.text)
        self.assertEqual(reloaded.json()["pairs_analyzed"], payload["pairs_analyzed"])

        history = self.client.get("/api/history").json()
        self.assertTrue(
            all("Cross-document scan" not in item["query"] for item in history)
        )

        single = self.client.post("/api/scan", json={"document_ids": [selected[0]["id"]]})
        self.assertEqual(single.status_code, 422)


    def test_09_document_content_persists(self) -> None:
        content = b"Persisted file bytes for download test."
        upload = self.client.post(
            "/api/ingest",
            files=[("files", ("persist_test.txt", content, "text/plain"))],
        )
        self.assertEqual(upload.status_code, 202, upload.text)
        document_id = upload.json()["documents"][0]["id"]

        # Wait for ingestion to finish.
        import time

        for _ in range(50):
            documents = self.client.get("/api/documents").json()["documents"]
            match = next((d for d in documents if d["id"] == document_id), None)
            if match is not None and match["status"] == "ready":
                break
            time.sleep(0.1)
        else:
            self.fail("document did not reach ready state")

        response = self.client.get(f"/api/documents/{document_id}/content")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.content, content)

        reindex = self.client.post(f"/api/documents/{document_id}/reindex")
        self.assertEqual(reindex.status_code, 200, reindex.text)

        for _ in range(50):
            documents = self.client.get("/api/documents").json()["documents"]
            match = next((d for d in documents if d["id"] == document_id), None)
            if match is not None and match["status"] == "ready":
                break
            time.sleep(0.1)
        else:
            self.fail("document did not reach ready state after reindex")

        delete = self.client.delete(f"/api/documents/{document_id}")
        self.assertEqual(delete.status_code, 200, delete.text)
        gone = self.client.get(f"/api/documents/{document_id}/content")
        self.assertEqual(gone.status_code, 404)
