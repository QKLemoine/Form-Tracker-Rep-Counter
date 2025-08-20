import cv2
import numpy as np
import time
import AITrainer.PoseEstimationModule as pm

cap = cv2.VideoCapture(0)

detector = pm.poseDetector()


while True:
    success, img = cap.read()
    img = detector.findPose(img,False)
    lmList = detector.getPosition(img, False)

    if len(lmList) != 0:
        #Right Arm
        detector.findAngle(img,12,14,16)

         #Left Arm
        detector.findAngle(img,11,13,15)



    cv2.imshow("Image", img)
    cv2.waitKey(1)
