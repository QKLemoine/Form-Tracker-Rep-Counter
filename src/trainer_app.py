import cv2
import numpy as np
import time
from core import PoseEstimationModule as pm

cap = cv2.VideoCapture(0)

detector = pm.poseDetector()
count = 0
dir = 0

while True:
    success, img = cap.read()
    img = detector.findPose(img,False)
    lmList = detector.getPosition(img, False)

    if len(lmList) != 0:
        #Right Arm
        angle = detector.findAngle(img,12,14,16)

        #Left Arm
        #detector.findAngle(img,11,13,15)

        per = np.interp(angle,(210,310),(0,100))

        bar = np.interp(angle,(210,310),(650,100))

        #check for dumb-curl
        if per == 100:
            if dir == 0:
                count += 0.5
                dir = 1
        if per == 0:
            if dir == 1:
                count += 0.5
                dir = 0

        #draw perc rep complete
        cv2.rectangle(img,(1100,100),(1175,650),(255,0,0),cv2.FILLED)
        cv2.rectangle(img,(1100,int(bar)),(1175,650),(255,0,0),cv2.FILLED)
        cv2.putText(img,str(int(per)),(1100,75),cv2.FONT_HERSHEY_PLAIN,4,(255,0,255),4)

        #draw rep count - inc 0.5
        cv2.putText(img,str(count),(50,100),cv2.FONT_HERSHEY_PLAIN,5,(255,255,0),5)

    cv2.imshow("Image", img)
    cv2.waitKey(1)
