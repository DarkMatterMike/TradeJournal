import os, uuid, mimetypes
from typing import Optional
import boto3
from botocore.client import Config

class R2Storage:
    def __init__(self):
        self.account_id = os.getenv('R2_ACCOUNT_ID','').strip()
        self.key_id = os.getenv('R2_ACCESS_KEY_ID','').strip()
        self.secret = os.getenv('R2_SECRET_ACCESS_KEY','').strip()
        self.bucket = os.getenv('R2_BUCKET','').strip()
        self.public_base = os.getenv('R2_PUBLIC_BASE_URL','').strip().rstrip('/')
        self.enabled = all([self.account_id,self.key_id,self.secret,self.bucket])
        self.client = None
        if self.enabled:
            endpoint = f'https://{self.account_id}.r2.cloudflarestorage.com'
            self.client = boto3.client('s3', endpoint_url=endpoint, aws_access_key_id=self.key_id, aws_secret_access_key=self.secret, config=Config(signature_version='s3v4'), region_name='auto')

    def put_file(self, *, day_id:int, kind:str, filename:str, content:bytes, content_type:Optional[str]=None) -> dict:
        if not self.enabled:
            raise RuntimeError('Cloudflare R2 variables are missing. Fill R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET.')
        safe = filename.replace('/','_').replace('\\','_')
        key = f'days/{day_id}/{kind}/{uuid.uuid4().hex}-{safe}'
        ct = content_type or mimetypes.guess_type(filename)[0] or 'application/octet-stream'
        self.client.put_object(Bucket=self.bucket, Key=key, Body=content, ContentType=ct)
        url = f'{self.public_base}/{key}' if self.public_base else self.presigned_get_url(key)
        return {'storage_key': key, 'url': url, 'content_type': ct}

    def presigned_get_url(self, key:str, expires:int=3600) -> str:
        return self.client.generate_presigned_url('get_object', Params={'Bucket': self.bucket, 'Key': key}, ExpiresIn=expires)
